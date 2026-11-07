// Name: Nookara Forums
// ID: ikelenenookaraforums
// Description: Read public communities, topics and posts from Nookara Forums.
// By: Ikelene
// License: MIT

// read only on purpose: writing on the forums only takes a token made by the Forums app itself (docs/FORUMS.md).
// reading is public, so this one doesnt need Nookara Login
(function (Scratch) {
  'use strict';

  const API = 'https://forums.nookara.cc/forums/api';
  const EXT_ID = 'ikelenenookaraforums';
  const str = value => Scratch.Cast.toString(value).trim();
  const page = value => Math.max(1, Math.floor(Scratch.Cast.toNumber(value)) || 1);

  class NookaraForums {
    getInfo() {
      return {
        id: EXT_ID,
        name: 'Nookara Forums',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks: [
          { blockType: Scratch.BlockType.LABEL, text: 'Communities' },
          { opcode: 'directory', blockType: Scratch.BlockType.REPORTER, text: 'communities by category as JSON' },
          { opcode: 'categories', blockType: Scratch.BlockType.REPORTER, text: 'categories as JSON' },
          { opcode: 'community', blockType: Scratch.BlockType.REPORTER, text: 'community [SLUG] as JSON', arguments: { SLUG: { type: Scratch.ArgumentType.STRING, defaultValue: 'important' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Topics and posts' },
          { opcode: 'feed', blockType: Scratch.BlockType.REPORTER, text: '[SORT] topics page [PAGE] as JSON', arguments: { SORT: { type: Scratch.ArgumentType.STRING, menu: 'sort', defaultValue: 'hot' }, PAGE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'communityTopics', blockType: Scratch.BlockType.REPORTER, text: '[SORT] topics in community [SLUG] page [PAGE] as JSON', arguments: { SORT: { type: Scratch.ArgumentType.STRING, menu: 'sort', defaultValue: 'new' }, SLUG: { type: Scratch.ArgumentType.STRING, defaultValue: 'important' }, PAGE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'topic', blockType: Scratch.BlockType.REPORTER, text: 'topic [ID] page [PAGE] with posts as JSON', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '1' }, PAGE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'search', blockType: Scratch.BlockType.REPORTER, text: 'search for [QUERY] page [PAGE] as JSON', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: 'nookara' }, PAGE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'profile', blockType: Scratch.BlockType.REPORTER, text: 'forum profile of [USERNAME] as JSON', arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Ikelene' } } },
        ],
        menus: {
          sort: { acceptReporters: true, items: ['hot', 'new', 'top'] },
        },
      };
    }

    async _get(path) {
      const response = await fetch(API + path);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      return JSON.stringify(data);
    }

    directory() { return this._get('/directory'); }
    categories() { return this._get('/categories'); }
    community({ SLUG }) { return this._get(`/c/${encodeURIComponent(str(SLUG))}`); }
    feed({ SORT, PAGE }) { return this._get(`/home?sort=${encodeURIComponent(str(SORT))}&page=${page(PAGE)}`); }
    communityTopics({ SORT, SLUG, PAGE }) { return this._get(`/c/${encodeURIComponent(str(SLUG))}/topics?sort=${encodeURIComponent(str(SORT))}&page=${page(PAGE)}`); }
    topic({ ID, PAGE }) { return this._get(`/t/${encodeURIComponent(str(ID))}?page=${page(PAGE)}`); }
    search({ QUERY, PAGE }) { return this._get(`/search?q=${encodeURIComponent(str(QUERY))}&page=${page(PAGE)}`); }
    profile({ USERNAME }) { return this._get(`/u/${encodeURIComponent(str(USERNAME))}`); }
  }

  Scratch.extensions.register(new NookaraForums());
})(Scratch);
