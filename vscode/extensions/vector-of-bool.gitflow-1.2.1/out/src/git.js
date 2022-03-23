"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const cmd_1 = require("./cmd");
const fail_1 = require("./fail");
// Taken from
// https://github.com/Microsoft/vscode/blob/cda3584a99d2832ab9d478c6b65ea45c96fe00c9/extensions/git/src/util.ts
function denodeify(fn) {
    return (...args) => new Promise((c, e) => fn(...args, (err, r) => err ? e(err) : c(r)));
}
exports.denodeify = denodeify;
const readdir = denodeify(fs.readdir);
function parseVersion(raw) {
    return raw.replace(/^git version /, '');
}
function findSpecificGit(path) {
    return new Promise((c, e) => {
        const buffers = [];
        const child = cp.spawn(path, ['--version']);
        child.stdout.on('data', (b) => buffers.push(b));
        child.on('error', e);
        child.on('exit', code => code ? e(new Error('Not found')) : c({
            path,
            version: parseVersion(Buffer.concat(buffers).toString('utf8').trim())
        }));
    });
}
function findGitDarwin() {
    return new Promise((c, e) => {
        cp.exec('which git', (err, gitPathBuffer) => {
            if (err) {
                return e('git not found');
            }
            const path = gitPathBuffer.toString().replace(/^\s+|\s+$/g, '');
            function getVersion(path) {
                // make sure git executes
                cp.exec('git --version', (err, stdout) => {
                    if (err) {
                        return e('git not found');
                    }
                    return c({ path, version: parseVersion(stdout.trim()) });
                });
            }
            if (path !== '/usr/bin/git') {
                return getVersion(path);
            }
            // must check if XCode is installed
            cp.exec('xcode-select -p', (err) => {
                if (err && err.code === 2) {
                    // git is not installed, and launching /usr/bin/git
                    // will prompt the user to install it
                    return e('git not found');
                }
                getVersion(path);
            });
        });
    });
}
function findSystemGitWin32(base) {
    if (!base) {
        return Promise.reject('Not found');
    }
    return findSpecificGit(path.join(base, 'Git', 'cmd', 'git.exe'));
}
function findGitHubGitWin32() {
    const github = path.join(process.env['LOCALAPPDATA'], 'GitHub');
    return readdir(github).then(children => {
        const git = children.filter(child => /^PortableGit/.test(child))[0];
        if (!git) {
            return Promise.reject('Not found');
        }
        return findSpecificGit(path.join(github, git, 'cmd', 'git.exe'));
    });
}
function id(val) {
    return val;
}
function findGitWin32() {
    return findSystemGitWin32(process.env['ProgramW6432'])
        .then(id, () => findSystemGitWin32(process.env['ProgramFiles(x86)']))
        .then(id, () => findSystemGitWin32(process.env['ProgramFiles']))
        .then(id, () => findSpecificGit('git'))
        .then(id, () => findGitHubGitWin32());
}
function findGit(hint) {
    var first = hint ? findSpecificGit(hint) : Promise.reject(null);
    return first.then(id, () => {
        switch (process.platform) {
            case 'darwin':
                return findGitDarwin();
            case 'win32':
                return findGitWin32();
            default:
                return findSpecificGit('git');
        }
    });
}
exports.findGit = findGit;
var git;
(function (git) {
    /**
     * Represents a git remote
     */
    class RemoteRef {
        constructor(name) {
            this.name = name;
        }
        /// Create a remote reference from a remote's name
        static fromName(name) {
            return new RemoteRef(name);
        }
    }
    git.RemoteRef = RemoteRef;
    var config;
    (function (config) {
        /// Get a git config value
        function get(setting) {
            return __awaiter(this, void 0, void 0, function* () {
                const result = yield cmd_1.cmd.execute(git.info.path, ['config', '--get', setting]);
                if (result.retc) {
                    return null;
                }
                return result.stdout.trim();
            });
        }
        config.get = get;
        /// Set a git config value
        function set(setting, value) {
            return __awaiter(this, void 0, void 0, function* () {
                const result = yield cmd_1.cmd.execute(git.info.path, ['config', setting, value]);
                return result.retc;
            });
        }
        config.set = set;
    })(config = git.config || (git.config = {}));
    class TagRef {
        constructor(name) {
            this.name = name;
        }
        /**
         * Get a tag reference by name
         */
        static fromName(name) {
            return new TagRef(name);
        }
        /**
         * Parse a list of tags returned by git
         */
        static parseListing(output) {
            return output.replace('\r\n', '\n')
                .trim()
                .split('\n')
                .filter(line => !!line.length)
                .map(line => line.trim())
                .reduce((acc, name) => {
                if (!(name in acc))
                    acc.push(name);
                return acc;
            }, [])
                .map(name => new TagRef(name));
        }
        /**
         * Get a list of all tags
         */
        static all() {
            return __awaiter(this, void 0, void 0, function* () {
                const result = yield cmd_1.cmd.executeRequired(git.info.path, ['tag', '-l']);
                return TagRef.parseListing(result.stdout);
            });
        }
        /**
         * Get latest tag
         */
        latest() {
            return __awaiter(this, void 0, void 0, function* () {
                let last_tag = '';
                const a_tag_exists = yield cmd_1.cmd.executeRequired(git.info.path, ['tag', '-l']);
                if (a_tag_exists.stdout.trim()) {
                    const latest_tagged_commit = yield cmd_1.cmd.executeRequired(git.info.path, ['rev-list', '--tags', '--max-count=1']);
                    const result = yield cmd_1.cmd.executeRequired(git.info.path, ['describe', '--tags', latest_tagged_commit.stdout.trim()]);
                    last_tag = result.stdout.trim();
                }
                return last_tag;
            });
        }
        /**
         * Check if the tag exists
         */
        exists() {
            return __awaiter(this, void 0, void 0, function* () {
                const self = this;
                const all = yield TagRef.all();
                return all.some(tag => tag.name === self.name);
            });
        }
    }
    git.TagRef = TagRef;
    class BranchRef {
        constructor(name) {
            this.name = name;
        }
        /**
         * Create a branch reference from a string name
         */
        static fromName(name) {
            return new BranchRef(name);
        }
        /**
         * Parse a list of branches returned by git stdout
         */
        static parseListing(output) {
            return output.replace('\r\n', '\n')
                .trim()
                .split('\n')
                .filter(line => !!line.length)
                .filter(line => line !== 'no branch')
                .map(line => line.trim())
                .map(line => line.replace(/^\* /, ''))
                .reduce((acc, name) => {
                if (!(name in acc))
                    acc.push(name);
                return acc;
            }, [])
                .map(name => new BranchRef(name));
        }
        /**
         * Get a list of branches available in the current directory
         */
        static all() {
            return __awaiter(this, void 0, void 0, function* () {
                const local_result = yield cmd_1.cmd.execute(git.info.path, ['branch', '--no-color']);
                const local_stdout = local_result.stdout;
                const remote_result = yield cmd_1.cmd.execute(git.info.path, ['branch', '-r', '--no-color']);
                const remote_stdout = remote_result.stdout;
                const filter = (output) => {
                    return output;
                };
                return BranchRef.parseListing(local_stdout + remote_stdout);
            });
        }
        /**
         * Test if a given branch exists
         */
        exists() {
            return __awaiter(this, void 0, void 0, function* () {
                const self = this;
                const all = yield BranchRef.all();
                return !!(all.find((branch) => branch.name === self.name));
            });
        }
        /**
         * Get the git hash that the branch points to
         */
        ref() {
            return __awaiter(this, void 0, void 0, function* () {
                const self = this;
                const result = yield cmd_1.cmd.execute(git.info.path, ['rev-parse', self.name]);
                return result.stdout.trim();
            });
        }
        /**
         * Get the name of the branch at a remote
         */
        remoteAt(remote) {
            return BranchRef.fromName(`${remote.name}/${this.name}`);
        }
    }
    git.BranchRef = BranchRef;
    ;
    /**
     * Get a reference to the currently checked out branch
     */
    function currentBranch() {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield cmd_1.cmd.executeRequired(git.info.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
            const name = result.stdout.trim();
            if (name === 'HEAD') {
                // We aren't attached to a branch at the moment
                return null;
            }
            return BranchRef.fromName(name);
        });
    }
    git.currentBranch = currentBranch;
    /**
     * Pull updates from the given ``remote`` for ``branch``
     */
    function pull(remote, branch) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield cmd_1.cmd.execute(git.info.path, ['pull', remote.name, branch.name]);
            if (result.retc !== 0) {
                fail_1.fail.error({ message: 'Failed to pull from remote. See git output' });
            }
            return result.retc;
        });
    }
    git.pull = pull;
    /**
     * Push updates to ``remote`` at ``branch``
     */
    function push(remote, branch) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield cmd_1.cmd.execute(git.info.path, ['push', remote.name, branch.name]);
            if (result.retc !== 0) {
                fail_1.fail.error({
                    message: 'Failed to push to remote. See git output',
                });
            }
            return result.retc;
        });
    }
    git.push = push;
    /**
     * Check if we have any unsaved changes
     */
    function isClean() {
        return __awaiter(this, void 0, void 0, function* () {
            const diff_res = yield cmd_1.cmd.execute(git.info.path, [
                'diff', '--no-ext-diff', '--ignore-submodules', '--quiet', '--exit-code'
            ]);
            if (!!diff_res.retc) {
                return false;
            }
            const diff_index_res = yield cmd_1.cmd.execute(git.info.path, [
                'diff-index', '--cached', '--quiet', '--ignore-submodules', 'HEAD', '--'
            ]);
            if (!!diff_index_res.retc) {
                return false;
            }
            return true;
        });
    }
    git.isClean = isClean;
    /**
     * Detect if the branch "subject" was merged into "base"
     */
    function isMerged(subject, base) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield cmd_1.cmd.executeRequired(git.info.path, ['branch', '--no-color', '--contains', subject.name]);
            const branches = BranchRef.parseListing(result.stdout);
            return branches.some((br) => br.name === base.name);
        });
    }
    git.isMerged = isMerged;
    /**
     * Checkout the given branch
     */
    function checkout(branch) {
        return checkoutRef(branch.name);
    }
    git.checkout = checkout;
    /**
     * Checkout the given git hash
     */
    function checkoutRef(ref) {
        return cmd_1.cmd.executeRequired(git.info.path, ['checkout', ref]);
    }
    git.checkoutRef = checkoutRef;
    /**
     * Merge one branch into the currently checked out branch
     */
    function merge(other) {
        return cmd_1.cmd.executeRequired(git.info.path, ['merge', '--no-ff', other.name]);
    }
    git.merge = merge;
    ;
    /**
     * Rebase one branch onto another
     */
    function rebase(args) {
        return cmd_1.cmd.executeRequired(git.info.path, ['rebase', args.onto.name, args.branch.name]);
    }
    git.rebase = rebase;
    /**
     * Require that two branches point to the same commit.
     *
     * If given ``true`` for ``offer_pull``, will offer the use the ability
     * to quickly pull from 'origin' onto the ``a`` branch.
     */
    function requireEqual(a, b, offer_pull = false) {
        return __awaiter(this, void 0, void 0, function* () {
            const aref = yield a.ref();
            const bref = yield b.ref();
            if (aref !== bref) {
                fail_1.fail.error({
                    message: `Branch "${a.name}" has diverged from ${b.name}`,
                    handlers: !offer_pull ? [] :
                        [
                            {
                                title: 'Pull now',
                                cb: function () {
                                    return __awaiter(this, void 0, void 0, function* () {
                                        git.pull(primaryRemote(), a);
                                    });
                                },
                            },
                        ],
                });
            }
        });
    }
    git.requireEqual = requireEqual;
    function requireClean() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(yield isClean())) {
                fail_1.fail.error({
                    message: 'Unsaved changes detected. Please commit or stash your changes and try again'
                });
            }
        });
    }
    git.requireClean = requireClean;
    function primaryRemote() {
        return RemoteRef.fromName('origin');
    }
    git.primaryRemote = primaryRemote;
})(git = exports.git || (exports.git = {}));
//# sourceMappingURL=git.js.map