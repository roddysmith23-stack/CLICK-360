'use strict';

// Regression guard for the exact production bug reported after r31: openAdvancedLabelModal()
// referenced `_editorPriceFormat` on a plain assignment line BEFORE the `let _editorPriceFormat`
// declaration a few lines below, in the same function scope. That is a temporal-dead-zone
// ReferenceError, thrown unconditionally on every open of "Configuración avanzada" — before the
// fix, showModal() had already inserted the modal shell (so the wizard "worked" and let the user
// step through it), but every statement after the throw — including the first updatePreview()
// call and every input handler that re-renders the canvas — never executed. That is why the
// label preview stayed permanently blank/black for every product and every saved template, in
// both "Modo simple" and "Modo experto" (same crash point, same function, same underlying cause).
//
// A general scope-aware "used before declared" scanner was attempted here and dropped: without a
// real JS parser it produced ~100 false positives (parameter/variable names shadowed across the
// dozens of nested arrow functions in this file are extremely common and are not bugs). Instead
// this asserts the exact, narrow, zero-noise property that was actually broken: the identifier's
// first occurrence anywhere in app.js must be its own `let` declaration, not an earlier bare
// assignment. This is precise for THIS bug and will not silently pass a reintroduction of it.

const fs = require('fs');
const assert = require('node:assert/strict');

const app = fs.readFileSync('app.js', 'utf8');

const declStatementIndex = app.indexOf('let _editorPriceFormat');
assert(declStatementIndex >= 0, '_editorPriceFormat declaration must still exist in app.js');
const declIndex = declStatementIndex + 'let '.length; // offset of the identifier itself

const firstUseIndex = app.indexOf('_editorPriceFormat');
assert.equal(firstUseIndex, declIndex,
  `_editorPriceFormat is referenced at offset ${firstUseIndex} before its own \`let\` declaration ` +
  `at offset ${declIndex} — this is the exact temporal-dead-zone ReferenceError that made the ` +
  `advanced label wizard's preview canvas permanently blank/black in production, in both ` +
  `"Modo simple" and "Modo experto", because showModal() runs before this point (so the modal ` +
  `shell renders) but every wire-up statement after this throw — including the first ` +
  `updatePreview() call — never executes.`);

// The declaration must also be initialized inline (not `let x = null;` followed by a stray
// reassignment above it) — that specific split-declaration/split-assignment shape is exactly
// what caused the bug the first time.
assert(/let _editorPriceFormat = initialTemplate\?\.priceFormat \|\| 'full';/.test(app),
  '_editorPriceFormat must be declared AND initialized on the same statement');

console.log('CLICK360_R32_TDZ_REGRESSION: PASS (_editorPriceFormat is never referenced before its own declaration)');
