"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const proc = require("child_process");
const vscode = require("vscode");
const fail_1 = require("./fail");
var cmd;
(function (cmd) {
    function execute(command, args, options) {
        return new Promise((resolve, reject) => {
            options = options || {};
            options.cwd = options.cwd || vscode.workspace.rootPath;
            console.log(`[gitflow] Execute ${command}`, args.join(' '));
            const child = proc.spawn(command, args, options);
            child.on('error', (err) => {
                reject(err);
            });
            let stdout_acc = '';
            let stderr_acc = '';
            child.stdout.on('data', (data) => {
                stdout_acc += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr_acc += data.toString();
            });
            child.on('close', (retc) => {
                console.log(`[gitflow] Command "${command}" returned code ${retc}: ${stderr_acc}`);
                resolve({ retc: retc, stdout: stdout_acc, stderr: stderr_acc });
            });
        });
    }
    cmd.execute = execute;
    ;
    function executeRequired(command, args, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield execute(command, args, options);
            if (result.retc !== 0) {
                fail_1.fail.error({ message: `"${command}" returned status ${result.retc}` });
            }
            return result;
        });
    }
    cmd.executeRequired = executeRequired;
})(cmd = exports.cmd || (exports.cmd = {}));
//# sourceMappingURL=cmd.js.map