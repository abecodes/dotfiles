'use strict';
const nodefs = require("fs");
var fs;
(function (fs) {
    function exists(path) {
        return new Promise((resolve, _) => {
            nodefs.exists(path, resolve);
        });
    }
    fs.exists = exists;
    function readFile(path) {
        return new Promise((resolve, reject) => {
            nodefs.readFile(path, (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(data);
            });
        });
    }
    fs.readFile = readFile;
    function writeFile(path, buf) {
        return new Promise((resolve, reject) => {
            nodefs.writeFile(path, buf, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    fs.writeFile = writeFile;
    function remove(path) {
        return new Promise((resolve, reject) => {
            nodefs.unlink(path, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    fs.remove = remove;
})(fs = exports.fs || (exports.fs = {}));
//# sourceMappingURL=fs.js.map