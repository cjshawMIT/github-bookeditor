define [
  'jquery'
  'underscore'
  'backbone'
  'marionette'
  'cs!helpers/logger'
  'cs!session'
  'cs!collections/content'
  'cs!collections/media-types'
  'cs!gh-book/epub-container'
  'cs!gh-book/xhtml-file'
  'cs!gh-book/opf-file'
  'cs!gh-book/toc-node'
  'cs!gh-book/binary-file'
  'cs!gh-book/auth'
  'cs!gh-book/remote-updater'
  'cs!gh-book/loading'
  'cs!configs/github.coffee'
  'less!gh-book/gh-book'
], ($, _, Backbone, Marionette, logger, session, allContent, mediaTypes, EpubContainer, XhtmlFile, OpfFile, TocNode, BinaryFile, WelcomeSignInView, remoteUpdater, LoadingView, config) ->

  # Stop logging.
  logger.stop()

  # Returns a promise that is resolved once all promises in the array `promises`
  # are resolved.
  onceAll = (promises) -> return $.when.apply($, promises)

  # Singleton that gets reloaded when the repo changes
  epubContainer = EpubContainer::instance()

  allContent.on 'add', (model, collection, options) ->
    return if options.loading

    # If the new model is a book then add it to epubContainer
    # Otherwise, add it to the manifest for all the books (Better safe than sorry)
    switch model.mediaType
      when OpfFile::mediaType
        # add the opf to the copy of the Epubcontainer
        # that is in allContent
        epubContainer.addChild(model)
      else
        allContent.each (book) ->
          book.manifest?.add(model) # Only books have a manifest

  # The WelcomeSignInView is overloaded to show Various Dialogs.
  #
  # - SignIn
  # - Repo Settings
  #
  # When there is a failure show the Settings/SignIn Modal
  welcomeView = new WelcomeSignInView {model:session}

  # This is a utility that wraps a promise and alerts when the promise fails.
  onFail = (promise, message='There was a problem.') ->
    complete = 0
    total = 0

    # promise.progress (msg) =>
    #   switch msg.type
    #     when 'start'  then total++
    #     when 'end'    then complete++
    #   console.log "Progress: #{complete}/#{total}: ", msg

    return promise.fail (err) =>
      repoUser = session.get('repoUser')
      repoName = session.get('repoName')
      branch = session.get('branch') or ''
      branch = "##{branch}" if branch

      # Show the WelcomeView's settings modal if there was a connection problem
      try
        App.main.show(welcomeView)
        welcomeView.editRepoModal(message)
      catch err
        alert("#{message} Are you pointing to a valid book? Using github/#{repoUser}/#{repoName}#{branch}")


  App = new Marionette.Application()

  App.addRegions
    main: '#main'


  App.addInitializer (options) ->

    # Register media types for editing
    mediaTypes.add EpubContainer
    mediaTypes.add XhtmlFile
    mediaTypes.add OpfFile
    mediaTypes.add TocNode
    mediaTypes.add BinaryFile, {mediaType:'image/png'}
    mediaTypes.add BinaryFile, {mediaType:'image/jpeg'}

    # set which media formats are allowed
    # at the toplevel of the content
    for type in EpubContainer::accept
      mediaTypes.type(type)::toplevel = true

    # Views use anchors with hrefs so catch the click and send it to Backbone
    $(document).on 'click', 'a:not([data-bypass]):not([href="#"])', (e) ->
      external = new RegExp('^((f|ht)tps?:)?//')
      href = $(@).attr('href')
      defaultPrevented = e.isDefaultPrevented()

      e.preventDefault()

      # open external urls in a new tab
      if external.test(href)
        if not defaultPrevented
          window.open(href, '_blank')

      # do nothing for javascript toggles
      else if $(@).attr('data-toggle')
        return

      # navagate the app
      else
        if href then Backbone.history.navigate(href, {trigger: true})


    # Populate the Session Model from localStorage
    STORED_KEYS = ['repoUser', 'repoName', 'branch', 'id', 'password', 'token']
    props = {}
    _.each STORED_KEYS, (key) ->
      value = window.sessionStorage.getItem key
      props[key] = value if value
    session.set props

    # On change, store info to localStorage
    session.on 'change', () =>
      # Update session storage
      for key in STORED_KEYS
        value =  session.get key
        if value
          window.sessionStorage.setItem key, value
        else
          window.sessionStorage.removeItem key, value



    # Github read/write and repo configuration
    writeFiles = (models, commitText) ->
      parentCommitSha = remoteUpdater.lastSeenSha
      promise = $.Deferred()

      # For each model, build a map of changed Content
      changedFiles = {}
      _.each models, (model) ->
        changedFiles[model.id] =
          isBase64: model.isBinary
          content: model.serialize()

      promise.done -> _.map models, (model) -> console.log 'saved', model.id
      promise.fail -> _.map models, (model) -> console.log 'failed saving', model.id

      session.getBranch().writeMany(changedFiles, commitText, parentCommitSha)
      .done((val) =>
        # Update the lastSeenSha so we do not load the commit we just made
        remoteUpdater.lastSeenSha = val.sha

        # Fire the onSave event on all the changed models
        _.map models, (model) -> model.onSaved?()
        promise.resolve(val)
      )
      .fail (err) =>
        # Probably a conflict because of a remote change.
        # Resolve the changes and save again
        #
        # Reload all the models (merging local changes along the way)
        # and, at the same time get the new lastSeenSha
        remoteUpdater.pollUpdates().then () =>
          # Probably a patch/cache problem.
          # Clear the cache and try again
          session.getClient().clearCache?()
          writeFiles(models, commitText)
          .fail((err) => promise.reject(err))
          .done (val) => promise.resolve(val)

      return promise


    readFile = (path, isBinary) -> session.getBranch().read path, isBinary
    readDir =        (path) -> session.getBranch().contents   path


    # Only support reading 1 file at a time.
    # Writing is done in batch by save (for multifile commits and conflict resolution).
    Backbone.sync = (method, model, options) ->

      path = model.id or model.url?() or model.url

      console.log method, path
      ret = null
      switch method
        when 'read' then ret = readFile(path, model.isBinary)
        else throw "Model sync method not supported: #{method}"

      ret.done (value) => options?.success?(value)
      ret.fail (error) => options?.error?(ret, error)
      return ret

    allContent_save = (contextModel=null, includeResources, includeNewContent) ->
      if contextModel
        # Save all the models that have changes EXCEPT other HTML files
        changedModels = @filter (model) ->
          if contextModel && model != contextModel
            switch model.mediaType
              # sometimes there is an epubContainer in allContent, this is bad - ignore it
              when EpubContainer::mediaType then return false
              when OpfFile::mediaType then return model.isDirty() # Always add OPF files
              when XhtmlFile::mediaType
                return includeNewContent and model.isNew()
              else
                return includeResources
          return model.isDirty()

      else
        # Save all the models that have changes
        changedModels = @filter (model) -> model.isDirty()

      changedModels.push epubContainer if epubContainer.isDirty()

      writeFiles(changedModels)

    allContent.save = allContent_save.bind(allContent)

  App.on 'start', () ->

    # Update the width/height of main so we can have CSS that uses `bottom: 0` or `right: 0`

    startRouting = () ->
      # Remove cyclic dependency. Controller depends on `App.main` region
      require ['cs!controllers/routing'], (controller) =>

        # Tell the controller which region to put all the views/layouts in
        controller.main = App.main

        controller.setRootNode(epubContainer)

        # Custom routes to configure the Github User and Repo from the browser
        router = new class GithubRouter extends Backbone.Router

          reconfigRepo: (repoUser, repoName, branch='') ->
            if session.get('repoUser') != repoUser or
                session.get('repoName') != repoName or
                session.get('branch') != branch

              session.set
                repoUser: repoUser
                repoName: repoName
                branch:   branch
              return true
            return false

          routes:
            '':             'goRepoSelect'
            'repo/:repoUser/:repoName(/branch/:branch)': 'goDefault'
            'repo/:repoUser/:repoName(/branch/:branch)/workspace': 'goWorkspace'
            'repo/:repoUser/:repoName(/branch/:branch)/migrate(/:task)': 'goMigrate'
            'repo/:repoUser/:repoName(/branch/:branch)/edit/*id': 'goEdit' # Edit an existing piece of content (id can be a path)

          _loadFirst: (repoUser, repoName, branch) ->
            if not repoName and not session.get('repoName')
              session.set config.defaultRepo, {}
            else if repoName
              # reconfigRepo does nothing if details did not change
              @reconfigRepo(repoUser, repoName, branch)

            promise = onFail(remoteUpdater.start(), 'There was a problem starting the remote updater')
            .then () =>
              return onFail(epubContainer.load(), 'There was a problem loading the repo')

            App.main.show(new LoadingView {model:epubContainer, promise:promise})
            return promise

          _navigate: (view) ->
            branch = session.get('branch')
            b = ''
            b = "/branch/#{branch}" if branch
            @navigate("repo/#{session.get('repoUser')}/#{session.get('repoName')}#{b}/#{view}")

          # Delay the route handling until the initial content is loaded
          # TODO: Move this into the controller
          goWorkspace: (repoUser, repoName, branch) ->
            @_loadFirst(repoUser, repoName, branch).done () =>
              controller.goWorkspace()

          goMigrate: (repoUser, repoName, branch, task) ->
            @_loadFirst(repoUser, repoName, branch).done () =>
              require ['cs!gh-book/migration', 'cs!views/layouts/workspace/table-of-contents', 'cs!gh-book/opf-file'], (MigrationView, TocView, OpfFile) ->
                # Find the first opf file.
                opf = allContent.findWhere({mediaType: OpfFile.prototype.mediaType})

                # Drop the menu, we can drop in our own later?
                controller._ensureLayout(null) # A little naughty?

                # Load the sidebar
                allContent.load()
                .fail(() => alert 'Problem loading workspace. Please refresh and try again')
                .done () =>
                  controller._showWorkspacePane(TocView)

                  if opf
                    contextView = new TocView
                      model: opf
                    controller.layout.sidebar.show(contextView)
                    contextView.maximize()

                  controller.layout.content.show(new MigrationView(task: task))

                  # Update the URL
                  controller.trigger 'navigate', task and "migrate/#{task}" or 'migrate'


          goEdit: (repoUser, repoName, branch, id, contextModel=null)    ->
            @_loadFirst(repoUser, repoName, branch).done () =>
              controller.goEdit(id, contextModel)

          goDefault: (repoUser, repoName, branch) ->
            @_loadFirst(repoUser, repoName, branch).done () ->
              require ['cs!gh-book/opf-file'], (OpfFile) ->
                # Find the first opf file.
                opf = allContent.findWhere({mediaType: OpfFile.prototype.mediaType})
                if opf
                  # Find the 1st leaf node (editable model)
                  model = opf.findDescendantDFS (model) -> return model.getChildren().isEmpty()

                  # The first item in the toc is always the opf file, followed by the
                  # TOC nodes.
                  controller.goEdit model, opf
                else
                  controller.goWorkspace()

          goRepoSelect: ->
            session.clearRepo()

            App.main.show(welcomeView)

            welcomeView.once 'close', () =>
              @goDefault(session.get('repoUser'), session.get('repoName'))

            welcomeView.editRepoModal()

        # When the controller navigates, ask our router to update the url.
        controller.on 'navigate', (route) -> router._navigate route

        # The Welcome view fires a settings-changed event on it's model if
        # the user changes the repo/branch.
        session.on 'settings-changed', () ->
          promise = onFail(epubContainer.reload(), 'There was a problem re-loading the repo')
          .done () ->
            # Get the first book from the epub
            opf = epubContainer.getChildren().at(0)
            if opf
              opf.load().done () ->
                # When that book is loaded, edit it.
                model = opf.findDescendantDFS (model) -> model.getChildren().isEmpty()
                controller.goEdit model, opf

          # Show the loading view while we load the new repo
          App.main.show(new LoadingView {model:epubContainer, promise:promise})

        Backbone.history.start
          pushState: false
          hashChange: true
          root: ''

    App.main.show(welcomeView)

    # If localStorage does not contain a password or OAuth token then show the SignIn modal.
    # Otherwise, load the workspace
    if session.get('password') or session.get('token')
  
      # since we already have a password, the session
      # will be doing things
      session.loaded.done ->
        startRouting()
    else
      # The user has not logged in yet so pop up the modal
      welcomeView.once 'close', () =>
        startRouting()

      welcomeView.signInModal()

  return App
