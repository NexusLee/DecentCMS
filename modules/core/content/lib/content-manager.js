// DecentCMS (c) 2014 Bertrand Le Roy, under MIT. See LICENSE.txt for licensing details.
'use strict';

var t = require('decent-core-localization').t;

function ContentManager(shell) {
  this.shell = shell;
  this.items = {};
  this.itemsToFetch = {};
  this.shapes = [];
}

ContentManager.on = {
  'decent-core-shell-start-request': function(shell, payload) {
    var contentManager =
          payload.req.contentManager =
            new ContentManager(shell);
    shell.on(shell.fetchContentEvent,
      contentManager._fetchContentHandler = function(payload) {
        contentManager.fetchItems(payload);
      }
    );
    shell.on(shell.renderPageEvent,
      contentManager._renderPageHandler = function(payload) {
        contentManager.buildRenderedPage(payload);
      }
    );
  },
  'decent-core-shell-end-request': function(shell, payload) {
    var contentManager = payload.req.contentManager;
    shell
      .removeListener(shell.fetchContentEvent, contentManager._fetchContentHandler)
      .removeListener(shell.renderPageEvent, contentManager._renderPageHandler);
    delete payload.req.contentManager;
    delete payload.req.layout;
  }
};

ContentManager.prototype.get = function(id, callback) {
  var self = this;
  var itemsToFetch = self.itemsToFetch;
  // id can be an array of ids
  id = Array.isArray(id) ? id : [id];
  id.forEach(function(itemId) {
    if (itemsToFetch.hasOwnProperty(itemId)) {
      if (callback) {
        itemsToFetch[itemId].push(callback);
      }
    }
    else {
      itemsToFetch[itemId] = callback ? [callback] : [];
    }
  });
};

ContentManager.prototype.getAvailableItem = function(id) {
  var item = this.items[id];
  if (item) return item;
  return null;
};

ContentManager.prototype.fetchItems = function(payload) {
  var self = this;
  var callback = payload.callback;
  for (var id in self.itemsToFetch) {
    if (self.items.hasOwnProperty(id)
      && self.itemsToFetch
      && self.itemsToFetch.hasOwnProperty(id)) {
      // items was already fetched, just call the callback
      // and remove the item from the list to fetch.
      for (var i = 0; i < self.itemsToFetch[id].length; i++) {
        var callback = self.itemsToFetch[id][i];
        if (callback) callback(self.items[id]);
      }
      delete self.itemsToFetch[id];
    }
  }
  // Now broadcast the list for content stores to do their job
  self.shell.emit(self.loadItemsEvent, {
    items: self.items,
    itemsToFetch: self.itemsToFetch,
    callback: function() {
      self.itemsFetchedCallback(null, {
        callback: callback
      });
    }
  });
  // Each handler should have synchronously removed the items it can take care of.
  if (Object.getOwnPropertyNames(self.items).length > 0) {
    var error = new Error(t('Couldn\'t load items %s', require('util').inspect(self.items)));
    if (callback) callback(error,  self.items);
  }
};

ContentManager.prototype.itemsFetchedCallback = function(err, data) {
  if (err) {
    if (data.callback) data.callback(err);
    return;
  }
  // If all items have been loaded from storage, it's time to start the next task
  if (Object.getOwnPropertyNames(this.itemsToFetch).length === 0) {
    data.callback();
  }
};

ContentManager.prototype.render = function(options) {
  if (!options.req.shapes) {
    options.req.shapes = [];
  }
  if (options.id) {
    this.get(options.id);
    options.req.shapes.push({
      meta: {
        type: 'shape-item-promise'
      },
      temp: {
        displayType: options.displayType
      },
      id: options.id
    });
  }
  else if (options.shape) {
    options.req.shapes.push(options.shape);
  }
};

ContentManager.prototype.buildRenderedPage = function(payload) {
  var req = payload.req;
  var res = payload.res;
  var shapes = req.shapes;
  var layout = req.layout = {meta: {type: 'layout'}};
  // Build the shape tree through placement strategies
  this.shell.emit('decent.core.shape.placement', {
    shape: layout,
    shapes: shapes
  });
  // Render the shape tree
  var renderStream = this.shell.require('render-stream', {contentManager: this});
  // TODO: add filters, that are just additional pipes before res.
  renderStream.on('data', function(data) {
    res.write(data);
  });
  // Let handlers manipulate items and shapes
  this.shell.emit(ContentManager.handleItemEvent, {
    shape: layout,
    renderStream: renderStream
  });
  // Render
  this.shell.emit('decent.core.shape.render', {
    shape: layout,
    renderStream: renderStream
  });
  // Tear down
  renderStream.end();
  res.end();
  console.log(t('%s handled %s in %s ms.', this.shell.name, req.url, new Date() - req.startTime));
};

// TODO: make event names consistent everywhere
// TODO: finish documenting emitted events

/**
 * @description
 * This event is emitted when content items should be fetched from stores.
 */
ContentManager.loadItemsEvent = ContentManager.prototype.loadItemsEvent = 'decent.core.load-items';
ContentManager.loadItemsEvent.payload = {
  /**
   * @description
   * The current map of id to item that we already have. The handlers add to this map.
   */
  items: Object,
  /**
   * @description
   * The list of item ids to fetch from the stores.
   * Handlers must remove from this list what they were able to successfully fetch.
   */
  itemsToFetch: Array,
  /**
   * @description
   * A function that handlers must call after they are done. This should be done asynchronously.
   */
  callback: Function
};

/**
 * @description
 * This item lets handlers manipulate the shapes before
 * they get rendered.
 * Handlers are responsible for drilling into the tree according to
 * their knowledge of the shapes they are handling.
 */
ContentManager.handleItemEvent = 'decent.core.handle-item';
ContentManager.handleItemEvent.payload = {
  /**
   * @description
   * The content item shape
   */
  item: Object,
  /**
   * @description
   * The shell
   */
  shell: Object
};

module.exports = ContentManager;