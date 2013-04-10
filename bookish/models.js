// Generated by CoffeeScript 1.3.3
(function() {

  define(['exports', 'jquery', 'backbone', 'bookish/media-types', 'i18n!bookish/nls/strings'], function(exports, jQuery, Backbone, MEDIA_TYPES, __) {
    var ALL_CONTENT, AllContent, Backbone_Model_toJSON, BaseBook, BaseContent, BaseModel, BookTocNode, BookTocNodeCollection, BookTocTree, CONTENT_COMPARATOR, Deferrable, DeferrableCollection, FilteredCollection;
    BaseModel = Backbone.Model.extend({
      isNew: function() {
        return !this.id || this.id.match(/^_NEW:/);
      },
      initialize: function() {
        if (!this.mediaType) {
          throw 'BUG: No mediaType set';
        }
        if (!MEDIA_TYPES.get(this.mediaType)) {
          throw 'BUG: No mediaType not registered';
        }
        if (!this.id) {
          return this.set({
            id: "_NEW:" + this.cid
          });
        }
      },
      accepts: function() {
        return [];
      },
      children: function() {
        return null;
      },
      addChild: function(model, at) {
        throw 'BUG_CHILD_NOT_ALLOWED';
      },
      editAction: null
    });
    ALL_CONTENT = null;
    Deferrable = BaseModel.extend({
      loaded: function(flag) {
        var deferred,
          _this = this;
        if (flag == null) {
          flag = false;
        }
        if (flag || this.isNew()) {
          deferred = jQuery.Deferred();
          deferred.resolve(this);
          this._promise = deferred.promise();
          this.set({
            _done: true
          });
        }
        if (!this._promise || 'rejected' === this._promise.state()) {
          this.set({
            _loading: true
          });
          this._promise = this.fetch({
            error: function(model, message, options) {
              return _this.trigger('error', model, message, options);
            }
          });
          this._promise.progress(function(progress) {
            return _this.set({
              _progress: progress
            });
          }).done(function() {
            delete _this.changed;
            return _this.set({
              _done: true
            });
          }).fail(function(error) {
            return _this.trigger('error', error);
          });
        }
        return this._promise;
      },
      toJSON: function() {
        var json;
        json = Backbone.Model.prototype.toJSON.apply(this, arguments);
        json.mediaType = this.mediaType;
        return json;
      }
    });
    DeferrableCollection = Backbone.Collection.extend({
      loaded: function(flag) {
        var deferred,
          _this = this;
        if (flag) {
          deferred = jQuery.Deferred();
          deferred.resolve(this);
          this._promise = deferred.promise();
          this._done = true;
        }
        if (!this._promise || 'rejected' === this._promise.state()) {
          this._promise = this.fetch({
            error: function(model, message, options) {
              return _this.trigger('error', model, message, options);
            }
          });
          this._promise.then(function() {
            return delete _this.changed;
          });
        }
        return this._promise;
      },
      toJSON: function() {
        var model, _i, _len, _ref, _results;
        _ref = this.models;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          model = _ref[_i];
          _results.push(model.toJSON());
        }
        return _results;
      },
      initialize: function() {
        this.on('add', function(model) {
          return ALL_CONTENT.add(model);
        });
        return this.on('reset', function(collection, options) {
          return ALL_CONTENT.add(collection.toArray());
        });
      }
    });
    AllContent = DeferrableCollection.extend({
      model: BaseContent,
      initialize: function() {
        return this.loaded(true);
      }
    });
    ALL_CONTENT = new AllContent();
    FilteredCollection = Backbone.Collection.extend({
      defaults: {
        collection: null
      },
      setFilter: function(str, mediaTypes) {
        var models,
          _this = this;
        if (mediaTypes == null) {
          mediaTypes = [];
        }
        if (this.filterStr === str) {
          return;
        }
        this.filterStr = str;
        this.filterMediaTypes = mediaTypes;
        models = this.collection.filter(function(model) {
          return _this.isMatch(model);
        });
        return this.reset(models);
      },
      isMatch: function(model) {
        var body, bodyText, found, title;
        if (this.filterMediaTypes.length && this.filterMediaTypes.indexOf(model.mediaType) < 0) {
          return false;
        }
        if (!this.filterStr) {
          return true;
        }
        title = model.get('title') || '';
        found = title.toLowerCase().search(this.filterStr.toLowerCase()) >= 0;
        if (found) {
          return true;
        }
        body = model.get('body') || '';
        return bodyText = body.replace(/\<(\/?[^\\>]+)\\>/, ' ').replace(/\s+/, ' ').trim();
      },
      initialize: function(models, options) {
        var _this = this;
        this.filterStr = options.filterStr || '';
        this.filterMediaTypes = options.mediaTypes || [];
        this.collection = options.collection;
        if (!this.collection) {
          throw 'BUG: Cannot filter on a non-existent collection';
        }
        this.add(this.collection.filter(function(model) {
          return _this.isMatch(model);
        }));
        this.listenTo(this.collection, 'add', function(model) {
          if (_this.isMatch(model)) {
            return _this.add(model);
          }
        });
        this.listenTo(this.collection, 'remove', function(model) {
          return _this.remove(model);
        });
        this.listenTo(this.collection, 'reset', function(model, options) {
          _this.reset();
          return _this.add(_this.collection.filter(function(model) {
            return _this.isMatch(model);
          }));
        });
        return this.listenTo(this.collection, 'change', function(model) {
          if (_this.isMatch(model)) {
            return _this.add(model);
          } else {
            return _this.remove(model);
          }
        });
      }
    });
    BaseContent = Deferrable.extend({
      mediaType: 'application/vnd.org.cnx.module',
      defaults: {
        title: null,
        subjects: [],
        keywords: [],
        authors: [],
        copyrightHolders: [],
        language: ((typeof navigator !== "undefined" && navigator !== null ? navigator.userLanguage : void 0) || (typeof navigator !== "undefined" && navigator !== null ? navigator.language : void 0) || 'en').toLowerCase()
      }
    });
    Backbone_Model_toJSON = Backbone.Model.prototype.toJSON;
    BookTocNode = BaseModel.extend({
      mediaType: 'application/vnd.org.cnx.container',
      toJSON: function() {
        var json;
        json = Backbone_Model_toJSON.apply(this);
        if (this._children.length) {
          json.children = this._children.toJSON();
        }
        return json;
      },
      contentId: function() {
        return this.id;
      },
      initialize: function() {
        var children,
          _this = this;
        this.on('change', function() {
          return _this.trigger('change:treeNode');
        });
        children = this.get('children');
        this.unset('children', {
          silent: true
        });
        this._children = new BookTocNodeCollection();
        this._children.on('add', function(child, collection, options) {
          child.parent = _this;
          return _this.trigger('add:treeNode', child, _this, options);
        });
        this._children.on('remove', function(child, collection, options) {
          delete child.parent;
          return _this.trigger('remove:treeNode', child, _this, options);
        });
        return this._children.add(children);
      },
      accepts: function() {
        return [BaseContent.prototype.mediaType, BookTocNode.prototype.mediaType];
      },
      children: function() {
        return this._children;
      },
      addChild: function(model, at) {
        if (at == null) {
          at = 0;
        }
        return this._children.add(model, {
          at: at
        });
      }
    });
    BookTocNodeCollection = Backbone.Collection.extend({
      model: BookTocNode
    });
    BookTocTree = BookTocNode.extend({
      toJSON: function() {
        return this.children().toJSON();
      },
      initialize: function() {
        var recDescendants,
          _this = this;
        BookTocNode.prototype.initialize.call(this);
        this.descendants = new BookTocNodeCollection();
        recDescendants = function(node) {
          _this.descendants.add(node);
          return typeof node.children === "function" ? node.children().each(function(child) {
            return recDescendants(child);
          }) : void 0;
        };
        this.children().each(function(child) {
          return recDescendants(child);
        });
        this.descendants.on('add:treeNode', function(node) {
          _this.descendants.add(node);
          return _this.trigger('add:treeNode', node);
        });
        this.descendants.on('remove:treeNode', function(node) {
          _this.descendants.remove(node);
          return _this.trigger('remove:treeNode', node);
        });
        this.on('add:treeNode', function(node) {
          return _this.descendants.add(node);
        });
        return this.on('remove:treeNode', function(node) {
          return _this.descendants.remove(node);
        });
      },
      reset: function(nodes) {
        var recAddDescendants,
          _this = this;
        this.descendants.reset();
        this.children().reset(nodes);
        recAddDescendants = function(node) {
          _this.descendants.add(node);
          return typeof node.children === "function" ? node.children().each(function(child) {
            return recAddDescendants(child);
          }) : void 0;
        };
        return this.children().each(function(child) {
          child.parent = _this;
          return recAddDescendants(child);
        });
      }
    });
    BaseBook = Deferrable.extend({
      mediaType: 'application/vnd.org.cnx.collection',
      defaults: {
        manifest: null,
        title: 'Untitled Book'
      },
      manifestType: Backbone.Collection,
      toJSON: function() {
        var json;
        json = Deferrable.prototype.toJSON.apply(this, arguments);
        json.navTree = this.navTreeRoot.toJSON();
        return json;
      },
      parseNavTree: function(li) {
        var $a, $li, $ol, obj;
        $li = jQuery(li);
        $a = $li.children('a, span');
        $ol = $li.children('ol');
        obj = {
          id: $a.attr('href') || $a.data('id')
        };
        if (!$a.hasClass('autogenerated-text')) {
          obj.title = $a.text();
        }
        obj["class"] = $a.data('class') || $a.not('span').attr('class');
        if ($ol[0]) {
          obj.children = (function() {
            var _i, _len, _ref, _results;
            _ref = $ol.children();
            _results = [];
            for (_i = 0, _len = _ref.length; _i < _len; _i++) {
              li = _ref[_i];
              _results.push(this.parseNavTree(li));
            }
            return _results;
          }).call(this);
        }
        return obj;
      },
      initialize: function() {
        var _this = this;
        this.manifest = new this.manifestType();
        this.navTreeRoot = new BookTocTree();
        this.listenTo(this.manifest, 'add', function(model, collection) {
          return ALL_CONTENT.add(model);
        });
        this.listenTo(this.manifest, 'reset', function(model, collection) {
          return ALL_CONTENT.add(model);
        });
        this.listenTo(this.manifest, 'change:id', function(model, newValue, oldValue) {
          var node;
          node = _this.navTreeRoot.descendants.get(oldValue);
          if (!node) {
            return console.error('BUG: There is an entry in the tree but no corresponding model in the manifest');
          }
          return node.set('id', newValue);
        });
        this.listenTo(this.navTreeRoot, 'add:treeNode', function(navNode) {
          return _this.manifest.add(ALL_CONTENT.get(navNode.contentId()));
        });
        this.listenTo(this.navTreeRoot, 'remove:treeNode', function(navNode) {
          return _this.manifest.remove(ALL_CONTENT.get(navNode.contentId()));
        });
        this.listenTo(this.navTreeRoot, 'add:treeNode', function(navNode) {
          return _this.trigger('add:treeNode', _this);
        });
        this.listenTo(this.navTreeRoot, 'remove:treeNode', function(navNode) {
          return _this.trigger('remove:treeNode', _this);
        });
        this.listenTo(this.navTreeRoot, 'change:treeNode', function(navNode) {
          _this.trigger('change:treeNode', _this);
          return _this.trigger('change', _this);
        });
        return ALL_CONTENT.add(this);
      },
      accepts: function() {
        return [BookTocNode.prototype.mediaType, BaseContent.prototype.mediaType];
      },
      children: function() {
        return this.navTreeRoot.children();
      },
      addChild: function(model, at) {
        if (at == null) {
          at = 0;
        }
        if (this.manifest.get(model.id)) {
          return;
        }
        if (BookTocNode.prototype.mediaType !== model.mediaType) {
          this.manifest.add(model);
          model = new BookTocNode({
            id: model.id
          });
        }
        return this.navTreeRoot.children().add(model, {
          at: at
        });
      }
    });
    CONTENT_COMPARATOR = function(a, b) {
      var A, B;
      A = a.mediaType || '';
      B = b.mediaType || '';
      if (B < A) {
        return -1;
      }
      if (A < B) {
        return 1;
      }
      A = a.get('title') || a.id || '';
      B = b.get('title') || b.id || '';
      if (B < A) {
        return 1;
      }
      if (A < B) {
        return -1;
      }
      return 0;
    };
    exports.FilteredCollection = FilteredCollection;
    exports.BaseContent = BaseContent;
    exports.BaseBook = BaseBook;
    exports.BookTocTree = BookTocTree;
    exports.Deferrable = Deferrable;
    exports.DeferrableCollection = DeferrableCollection;
    exports.ALL_CONTENT = ALL_CONTENT;
    exports.CONTENT_COMPARATOR = CONTENT_COMPARATOR;
    exports.WORKSPACE = ALL_CONTENT;
    return exports;
  });

}).call(this);
