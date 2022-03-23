'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const vscode_1 = require("vscode");
const charactersToTabOutFrom_1 = require("./charactersToTabOutFrom");
const utils_1 = require("./utils");
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    let isDisabledByDefault = vscode.workspace.getConfiguration("tabout").get('disableByDefault');
    context.workspaceState.update("tabout-active", (isDisabledByDefault ? false : true));
    context.subscriptions.push(vscode.commands.registerCommand('toggle-tabout', () => {
        let currentState = context.workspaceState.get("tabout-active");
        context.workspaceState.update("tabout-active", !currentState);
        vscode_1.window.showInformationMessage("TabOut is " + (!currentState ? "" : " NOT ") + "active");
    }));
    let tabout = vscode.commands.registerCommand('tabout', () => {
        // The code you place here will be executed every time your command is executed
        let editor = vscode_1.window.activeTextEditor;
        //vscode.commands.executeCommand("acceptSelectedSuggestion");
        if (!editor)
            return;
        if (!context.workspaceState.get('tabout-active')) {
            vscode_1.commands.executeCommand("tab");
            return;
        }
        let currentLineText = editor.document.lineAt(editor.selection.active.line).text;
        let currentPositionInLine = editor.selection.active.character;
        if (currentPositionInLine == 0) {
            vscode_1.commands.executeCommand("tab");
            return;
        }
        if (editor.selection.active.character > 0) {
            var rangeBeforeCurrentPosition = new vscode_1.Range(new vscode_1.Position(editor.selection.active.line, 0), new vscode_1.Position(editor.selection.active.line, currentPositionInLine));
            var textBeforeCurrentPosition = editor.document.getText(rangeBeforeCurrentPosition);
            if (textBeforeCurrentPosition.trim() == "") {
                vscode_1.commands.executeCommand("tab");
                return;
            }
        }
        //Previous character special?
        let previousCharacter = utils_1.getPreviousChar(currentPositionInLine, currentLineText);
        let characterInfo = charactersToTabOutFrom_1.characterSetsToTabOutFrom().find(o => o.open == previousCharacter || o.close == previousCharacter);
        if (characterInfo !== undefined) {
            let nextCharacter = utils_1.getNextChar(currentPositionInLine, currentLineText);
            let indxNext = charactersToTabOutFrom_1.characterSetsToTabOutFrom().find(o => o.open == nextCharacter || o.close == nextCharacter);
            if (indxNext !== undefined) {
                return utils_1.selectNextCharacter(currentLineText, currentPositionInLine);
            }
        }
        if (characterInfo !== undefined) {
            //no tab, put selection just before the next special character
            let positionNextSpecialCharacter = utils_1.determineNextSpecialCharPosition(characterInfo, currentLineText, currentPositionInLine);
            if (positionNextSpecialCharacter > -1) {
                //Move cursor
                let nextCursorPosition = new vscode.Position(editor.selection.active.line, positionNextSpecialCharacter);
                return editor.selection = new vscode.Selection(nextCursorPosition, nextCursorPosition);
            }
        }
        //Next character special?
        return utils_1.selectNextCharacter(currentLineText, currentPositionInLine);
    });
    context.subscriptions.push(tabout);
}
exports.activate = activate;
// this method is called when your extension is deactivated
function deactivate() {
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map