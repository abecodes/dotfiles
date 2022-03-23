"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.characterSetsToTabOutFrom = void 0;
const CharacterSet_1 = require("./CharacterSet");
function characterSetsToTabOutFrom() {
    var charArray = new Array();
    charArray.push(new CharacterSet_1.CharacterSet('[', ']'));
    charArray.push(new CharacterSet_1.CharacterSet('{', '}'));
    charArray.push(new CharacterSet_1.CharacterSet('(', ')'));
    charArray.push(new CharacterSet_1.CharacterSet('\'', '\''));
    charArray.push(new CharacterSet_1.CharacterSet('"', '"'));
    charArray.push(new CharacterSet_1.CharacterSet(':', ':'));
    charArray.push(new CharacterSet_1.CharacterSet('=', '='));
    charArray.push(new CharacterSet_1.CharacterSet('>', '>'));
    charArray.push(new CharacterSet_1.CharacterSet('<', '<'));
    charArray.push(new CharacterSet_1.CharacterSet('.', '.'));
    charArray.push(new CharacterSet_1.CharacterSet('`', '`'));
    charArray.push(new CharacterSet_1.CharacterSet(';', ';'));
    return charArray;
}
exports.characterSetsToTabOutFrom = characterSetsToTabOutFrom;
//# sourceMappingURL=charactersToTabOutFrom.js.map