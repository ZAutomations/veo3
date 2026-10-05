// Tests for reading a tile's name back, and for judging whether a rename took.
//
// The run these exist for, from the MCP console:
//
//   [1/1] Studio
//     new tile appeared (0 -> 1); renaming to "Studio"
//     rename attempt 1 did not take (tile still "null") - retrying
//     rename attempt 2 did not take (tile still "null") - retrying
//     rename attempt 3 did not take (tile still "null") - retrying
//     generated, but rename failed: rename did not commit after 3 attempts
//   Done: 0 made, 1 failed, of 1.
//
// The rename was going in. What was broken was the READING: the tile's label is
// an <input class="editable-text-input"> on that build, and an input's text lives
// in .value, which innerText never sees - so tileName() answered null, null was
// scored as "the name is wrong", the same tile was renamed twice more, and the
// whole refs stage was discarded and the batch aborted with it, one generated
// image and all.
//
// Run: node test_ref_rename.js     (no browser, no network)
const G = require('./generate_refs.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}
function eq(name, got, want) { ok(name, got === want, `${JSON.stringify(got)} !== ${JSON.stringify(want)}`); }

// A stand-in for one media tile: the tile root holds the label, and the tile's
// own More-options button is what MEDIA_MORE finds.
function fakeTile({ text = '', inputs = [], titles = [] } = {}) {
    const root = {
        innerText: text,
        parentElement: null,
        querySelectorAll(sel) {
            if (/\[title\]/.test(sel)) return titles.map((v) => ({ getAttribute: () => v }));
            if (/input|textarea/.test(sel)) return inputs.map((v) => ({ value: v }));
            return [];
        },
        closest: () => null,
    };
    const more = {
        closest(sel) {
            if (/header-right-container|header-desktop-main-row/.test(sel)) return null;
            if (/hover-overlay/.test(sel)) return root;
            return null;
        },
        scrollIntoView() {}, click() {},
    };
    return { root, more };
}
function pageWithTiles(tiles) {
    global.document = {
        querySelectorAll: (sel) => (/More options/.test(sel) ? tiles.map((t) => t.more) : []),
        querySelector: () => null,
    };
    return { evaluate: (fn, arg) => fn(arg) };
}

(async () => {
    console.log('\n--- the name is read from the label, however the label is drawn ---');

    // The regression. The label is an input, so innerText is empty and only
    // .value carries the name.
    global.document = null;
    let p = pageWithTiles([fakeTile({ inputs: ['Studio'] })]);
    eq('a name that lives in an input .value is read', await G.tileName(p, 0), 'Studio');

    // The ordinary case still works: the label is plain text, with the hover
    // icons sitting next to it.
    p = pageWithTiles([fakeTile({ text: 'Studio more_vert' })]);
    eq('a plain-text label is read with the icon words stripped', await G.tileName(p, 0), 'Studio');

    p = pageWithTiles([fakeTile({ text: 'more_vert favorite' })]);
    eq('a label that is nothing but icons gives nothing', await G.tileName(p, 0), null);

    console.log('\n--- an action label is not a name ---');
    // The tile's own More-options button carries this text. Returning it would
    // make every verification fail, which is the same bug wearing a hat.
    p = pageWithTiles([fakeTile({ text: 'more_vert', titles: ['More options'] })]);
    eq('"More options" is not taken for the tile name', await G.tileName(p, 0), null);

    p = pageWithTiles([fakeTile({ text: 'more_vert', inputs: ['Studio'], titles: ['More options'] })]);
    eq('and the real name is still found beside it', await G.tileName(p, 0), 'Studio');

    // The second live run. Flow renders the hover actions as one run of text
    // with no separators, so the label read back as "favoriteredomore_vert" -
    // and a strip that needs word boundaries cannot touch it, because "favorite"
    // in there is followed by "r". It was taken for the tile's name, the rename
    // was scored a failure three times, and the stage was discarded again.
    p = pageWithTiles([fakeTile({ text: 'favoriteredomore_vert' })]);
    eq('concatenated icon ligatures are not a name', await G.tileName(p, 0), null);

    p = pageWithTiles([fakeTile({ text: 'favoriteredomore_vert', inputs: ['Studio'] })]);
    eq('and the name beside them is still read', await G.tileName(p, 0), 'Studio');

    // A real name that merely CONTAINS an icon word must survive.
    p = pageWithTiles([fakeTile({ text: 'Addison' })]);
    eq('a name containing an icon word is not eaten', await G.tileName(p, 0), 'Addison');
    p = pageWithTiles([fakeTile({ text: 'Studio favorite' })]);
    eq('a name beside a separated icon word keeps the name', await G.tileName(p, 0), 'Studio');
    // The soup test is for innerText only. A place or character that happens to
    // be called "Home" is a name, and dropping it would leave the tile unreadable
    // for the same reason the icons were - at which point the box decides alone.
    p = pageWithTiles([fakeTile({ inputs: ['Home'] })]);
    eq('a name spelled like an icon word still reads', await G.tileName(p, 0), 'Home');
    p = pageWithTiles([fakeTile({ titles: ['Image'] })]);
    eq('and so does a title that spells one', await G.tileName(p, 0), 'Image');

    console.log('\n--- nothing to read is null, not a wrong name ---');
    eq('no tiles at all', await G.tileName(pageWithTiles([]), 0), null);
    eq('a tile with no label anywhere', await G.tileName(pageWithTiles([fakeTile({})]), 0), null);
    eq('an empty input is not a name', await G.tileName(pageWithTiles([fakeTile({ inputs: ['   '] })]), 0), null);
    // idx past the end must not throw
    eq('an index with no tile behind it', await G.tileName(pageWithTiles([fakeTile({ text: 'Studio' })]), 4), null);
    // the newest tile is index 0, and the second-newest is reachable too
    const two = [fakeTile({ inputs: ['Studio'] }), fakeTile({ inputs: ['Maya'] })];
    eq('index 0 is the newest', await G.tileName(pageWithTiles(two), 0), 'Studio');
    eq('index 1 is the one before it', await G.tileName(pageWithTiles(two), 1), 'Maya');

    console.log('\n--- a readable label decides on its own ---');
    const v = (o) => G.renameVerdict(o);
    ok('the name on the tile is accepted', v({ label: 'Studio', typed: 'Studio', closed: true, want: 'Studio' }).ok);
    eq('and is credited to the tile label', v({ label: 'Studio', typed: 'x', closed: true, want: 'Studio' }).via, 'tile label');
    ok('a label carrying extra text still counts', v({ label: 'Studio 1', typed: '', closed: true, want: 'Studio' }).ok);
    ok('case does not matter', v({ label: 'studio', typed: '', closed: false, want: 'Studio' }).ok);

    console.log('\n--- the rename box is the authority ---');
    // The live run again: the box held "Studio" and the box closed, so the
    // rename was committed. Only the tile's own label disagreed, and a label is
    // markup this process does not control - scoring it over the box's evidence
    // is what killed the stage twice. The disagreement is reported instead.
    let d = v({ label: 'Untitled', typed: 'Studio', closed: true, want: 'Studio' });
    ok('a disagreeing label does not fail a committed rename', d.ok);
    eq('it is credited to the box', d.via, 'rename box');
    eq('and the label that disagreed is passed on', d.labelSays, 'Untitled');
    eq('an agreeing label carries no disagreement',
       v({ label: 'Studio', typed: 'Studio', closed: true, want: 'Studio' }).labelSays, undefined);

    console.log('\n--- an unreadable label falls back to the rename box ---');
    // This is the run that broke: the label reads null and everything else was
    // fine. Three attempts were spent re-renaming a tile that was already right.
    let r = v({ label: null, typed: 'Studio', closed: true, want: 'Studio' });
    ok('a null label with the box closed over the right name is accepted', r.ok);
    eq('and is credited to the rename box', r.via, 'rename box');
    ok('surrounding whitespace in the box is forgiven',
       v({ label: null, typed: '  Studio ', closed: true, want: 'Studio' }).ok);
    ok('but a box still holding the OLD name is not', !v({ label: null, typed: 'Untitled', closed: true, want: 'Studio' }).ok);
    ok('an empty box is not', !v({ label: null, typed: '', closed: true, want: 'Studio' }).ok);
    // If Done never landed the overlay is still up, and an open box proves
    // nothing - the name has not been committed yet.
    ok('a box that never closed proves nothing', !v({ label: null, typed: 'Studio', closed: false, want: 'Studio' }).ok);
    ok('an empty label with no box either is still a failure',
       !v({ label: null, typed: '', closed: true, want: 'Studio' }).ok);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
