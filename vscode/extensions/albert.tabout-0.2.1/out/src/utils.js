"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectNextCharacter = exports.determineNextSpecialCharPosition = exports.getNextChar = exports.getPreviousChar = exports.oneNumberIsNegative = exports.returnLowest = exports.returnHighest = void 0;
const charactersToTabOutFrom_1 = require("./charactersToTabOutFrom");
const vscode_1 = require("vscode");
function returnHighest(num1, num2) {
    return num1 > num2 ? num1 : num2;
}
exports.returnHighest = returnHighest;
function returnLowest(num1, num2) {
    return num1 < num2 ? num1 : num2;
}
exports.returnLowest = returnLowest;
function oneNumberIsNegative(num1, num2) {
    return (num1 <= -1 || num2 <= -1);
}
exports.oneNumberIsNegative = oneNumberIsNegative;
function getPreviousChar(currentPosition, text) {
    return text.substring(currentPosition - 1, currentPosition);
}
exports.getPreviousChar = getPreviousChar;
function getNextChar(currentPosition, text) {
    return text.substring(currentPosition + 1, currentPosition);
}
exports.getNextChar = getNextChar;
function determineNextSpecialCharPosition(charInfo, text, position) {
    let positionNextOpenChar = text.indexOf(charInfo.open, position + 1);
    if (positionNextOpenChar == -1) {
        positionNextOpenChar = text.indexOf(charInfo.close, position + 1);
    }
    if (positionNextOpenChar == -1) {
        //find first other special character    
        var strToSearchIn = text.substr(position);
        var counter = position;
        for (var char of strToSearchIn) {
            counter++;
            let info = charactersToTabOutFrom_1.characterSetsToTabOutFrom().find(c => c.open == char || c.close == char);
            if (info !== undefined) {
                positionNextOpenChar = counter;
                break;
            }
        }
    }
    return positionNextOpenChar;
}
exports.determineNextSpecialCharPosition = determineNextSpecialCharPosition;
function selectNextCharacter(text, position) {
    let nextCharacter = getNextChar(position, text);
    let indxNext = charactersToTabOutFrom_1.characterSetsToTabOutFrom().find(o => o.open == nextCharacter || o.close == nextCharacter);
    if (indxNext !== undefined) {
        //no tab, put selection just AFTER the next special character 
        let nextCursorPosition = new vscode_1.Position(vscode_1.window.activeTextEditor.selection.active.line, position + 1);
        return vscode_1.window.activeTextEditor.selection = new vscode_1.Selection(nextCursorPosition, nextCursorPosition);
    }
    //Default
    vscode_1.commands.executeCommand("tab");
}
exports.selectNextCharacter = selectNextCharacter;
//# sourceMappingURL=utils.js.map