"use strict";
const vscode = require("vscode");
class ConfigReader {
    _readConfig(key, default_) {
        const val = vscode.workspace.getConfiguration('gitflow').get(key);
        if (val === undefined) {
            return default_;
        }
        return val;
    }
    get deleteBranchOnFinish() {
        return this._readConfig('deleteBranchOnFinish', true);
    }
    get deleteRemoteBranches() {
        return this._readConfig('deleteRemoteBranches', true);
    }
    get default_development() {
        return this._readConfig('default.development', 'develop');
    }
    get default_production() {
        return this._readConfig('default.production', 'master');
    }
}
exports.config = new ConfigReader();
//# sourceMappingURL=config.js.map