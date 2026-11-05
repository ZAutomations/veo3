'use strict';

const config = require('./preset_display_order.json');
const featuredRank = new Map(config.featured.map((id, index) => [id, index]));
const relationshipPattern = new RegExp(config.relationship_match, 'i');

function sortPresets(presets) {
    return (presets || []).map((preset, index) => ({ preset, index })).sort((a, b) => {
        const idA = String(a.preset.id || '').toLowerCase();
        const idB = String(b.preset.id || '').toLowerCase();
        const pinnedA = featuredRank.has(idA) ? featuredRank.get(idA) : Infinity;
        const pinnedB = featuredRank.has(idB) ? featuredRank.get(idB) : Infinity;
        if (pinnedA !== pinnedB) return pinnedA - pinnedB;
        const relA = relationshipPattern.test([a.preset.id, a.preset.name, a.preset.label, a.preset.niche].join(' '));
        const relB = relationshipPattern.test([b.preset.id, b.preset.name, b.preset.label, b.preset.niche].join(' '));
        if (relA !== relB) return relA ? -1 : 1;
        return a.index - b.index;
    }).map(row => row.preset);
}

module.exports = { sortPresets, featured: config.featured.slice() };
