/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { JsonParseMode, isJsonObject, join, normalize, parseJson } from '@angular-devkit/core';
import { Rule, Tree, chain, noop } from '@angular-devkit/schematics';
import * as ts from '../../third_party/github.com/Microsoft/TypeScript/lib/typescript';

const toDrop: {[importName: string]: true} = {
  'core-js/es6/symbol': true,
  'core-js/es6/object': true,
  'core-js/es6/function': true,
  'core-js/es6/parse-int': true,
  'core-js/es6/parse-float': true,
  'core-js/es6/number': true,
  'core-js/es6/math': true,
  'core-js/es6/string': true,
  'core-js/es6/date': true,
  'core-js/es6/array': true,
  'core-js/es6/regexp': true,
  'core-js/es6/map': true,
  'core-js/es6/set': true,
};

const header = `/**
*/

/***************************************************************************************************
* BROWSER POLYFILLS
*/

/** IE9, IE10 and IE11 requires all of the following polyfills. **/
// import 'core-js/es6/weak-map';`;

const applicationPolyfillsHeader = 'APPLICATION IMPORTS';

function dropES2015PolyfillsFromFile(polyfillPath: string): Rule {
  return (tree: Tree) => {
    const source = tree.read(polyfillPath);
    if (!source) {
      return noop();
    }

    // Start the update of the file.
    const recorder = tree.beginUpdate(polyfillPath);

    const sourceFile = ts.createSourceFile(polyfillPath,
      source.toString(),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = sourceFile.statements
      .filter(s => s.kind === ts.SyntaxKind.ImportDeclaration) as ts.ImportDeclaration[];

    const applicationPolyfillsStart = sourceFile.getText().indexOf(applicationPolyfillsHeader);

    if (imports.length === 0) { return noop(); }

    for (const i of imports) {
      const module = ts.isStringLiteral(i.moduleSpecifier) && i.moduleSpecifier.text;
      // We do not want to remove imports which are after the "APPLICATION IMPORTS" header.
      if (module && toDrop[module] && applicationPolyfillsStart > i.getFullStart()) {
        recorder.remove(i.getFullStart(), i.getFullWidth());
      }
    }

    // We've removed the header since it's part of the JSDoc of the nodes we dropped
    // As part of the header, we also add the comment for importing WeakMap since
    // it's not part of the internal ES2015 polyfills we provide.
    if (sourceFile.getText().indexOf(header) < 0) {
      recorder.insertLeft(0, header);
    }

    tree.commitUpdate(recorder);
  };
}

/**
 * Move the import reflect metadata polyfill from the polyfill file to the dev environment. This is
 * not guaranteed to work, but if it doesn't it will result in no changes made.
 */
export function dropES2015Polyfills(): Rule {
  return (tree) => {
    // Simple. Take the ast of polyfills (if it exists) and find the import metadata. Remove it.
    const angularConfigContent = tree.read('angular.json') || tree.read('.angular.json');
    const rules: Rule[] = [];

    if (!angularConfigContent) {
      // Is this even an angular project?
      return;
    }

    const angularJson = parseJson(angularConfigContent.toString(), JsonParseMode.Loose);

    if (!isJsonObject(angularJson) || !isJsonObject(angularJson.projects)) {
      // If that field isn't there, no use...
      return;
    }

    // For all projects
    for (const projectName of Object.keys(angularJson.projects)) {
      const project = angularJson.projects[projectName];
      if (!isJsonObject(project)) {
        continue;
      }
      if (typeof project.sourceRoot != 'string' || project.projectType !== 'application') {
        continue;
      }

      rules.push(dropES2015PolyfillsFromFile(join(normalize(project.sourceRoot), '/polyfills.ts')));
    }

    return chain(rules);
  };
}
