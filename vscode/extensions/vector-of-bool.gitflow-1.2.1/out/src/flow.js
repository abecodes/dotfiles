'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
const vscode = require("vscode");
const path = require("path");
const fail_1 = require("./fail");
const git_1 = require("./git");
const cmd_1 = require("./cmd");
const fs_1 = require("./fs");
const config_1 = require("./config");
const withProgress = vscode.window.withProgress;
var flow;
(function (flow) {
    flow.gitDir = path.join(vscode.workspace.rootPath, '.git');
    flow.gitflowDir = path.join(flow.gitDir, '.gitflow');
    /**
     * Get the release branch prefix
     */
    function releasePrefix() {
        return git_1.git.config.get('gitflow.prefix.release');
    }
    flow.releasePrefix = releasePrefix;
    /**
     * Get the tag prefix
     */
    function tagPrefix() {
        return git_1.git.config.get('gitflow.prefix.versiontag');
    }
    flow.tagPrefix = tagPrefix;
    /**
     * Get develop branch name
     */
    function developBranch() {
        return git_1.git.config.get('gitflow.branch.develop')
            .then(git_1.git.BranchRef.fromName);
    }
    flow.developBranch = developBranch;
    /**
     * Get the master branch name
     */
    function masterBranch() {
        return git_1.git.config.get('gitflow.branch.master').then(git_1.git.BranchRef.fromName);
    }
    flow.masterBranch = masterBranch;
    function flowEnabled() {
        return __awaiter(this, void 0, void 0, function* () {
            const master = yield git_1.git.config.get('gitflow.branch.master');
            const develop = yield git_1.git.config.get('gitflow.branch.develop');
            return !!(master) && !!(develop);
        });
    }
    flow.flowEnabled = flowEnabled;
    function requireFlowEnabled() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(yield flowEnabled())) {
                // Ask the user to enable gitflow
                fail_1.fail.error({
                    message: 'Gitflow is not initialized for this project',
                    handlers: [{
                            title: 'Enable now',
                            cb: flow.initialize,
                        }]
                });
            }
        });
    }
    flow.requireFlowEnabled = requireFlowEnabled;
    function requireNoSuchBranch(br, err) {
        return __awaiter(this, void 0, void 0, function* () {
            if (yield br.exists()) {
                fail_1.fail.error(err);
            }
        });
    }
    flow.requireNoSuchBranch = requireNoSuchBranch;
    function throwNotInitializedError() {
        throw fail_1.fail.error({
            message: 'Gitflow has not been initialized for this repository',
            handlers: [{
                    title: 'Initialize',
                    cb() {
                        return flow.initialize();
                    }
                }]
        });
    }
    flow.throwNotInitializedError = throwNotInitializedError;
    function initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Init');
            if (yield flowEnabled()) {
                const do_reinit = !!(yield vscode.window.showWarningMessage('Gitflow has already been initialized for this repository. Would you like to re-initialize?', 'Yes'));
                if (!do_reinit)
                    return;
            }
            const branchNonEmpty = str => !!str ? '' : 'A branch name is required';
            const master_name = yield vscode.window.showInputBox({
                prompt: 'Enter a name for the production branch',
                value: config_1.config.default_production,
                validateInput: branchNonEmpty,
            });
            if (!master_name)
                return;
            const develop_name = yield vscode.window.showInputBox({
                prompt: 'Enter a name for the development branch',
                value: config_1.config.default_development,
                validateInput: branchNonEmpty,
            });
            if (!develop_name)
                return;
            if (master_name === develop_name) {
                fail_1.fail.error({
                    message: 'Production and development branches must differ',
                });
            }
            const develop = git_1.git.BranchRef.fromName(develop_name);
            const master = git_1.git.BranchRef.fromName(master_name);
            const remote_develop = git_1.git.BranchRef.fromName('origin/' + develop_name);
            const remote_master = git_1.git.BranchRef.fromName('origin/' + master_name);
            // Check if the repository needs to be initialized before we proceed
            if (!!(yield cmd_1.cmd.execute(git_1.git.info.path, [
                'rev-parse', '--quiet', '--verify', 'HEAD'
            ])).retc) {
                yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['symbolic-ref', 'HEAD', `refs/heads/${master.name}`]);
                yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['commit', '--allow-empty', '--quiet', '-m', 'Initial commit']);
            }
            // Ensure the develop branch exists
            if (!(yield develop.exists())) {
                if (yield remote_develop.exists()) {
                    // If there is a remote with the branch, set up our local copy to track
                    // that one
                    cmd_1.cmd.executeRequired(git_1.git.info.path, ['branch', develop.name, remote_develop.name]);
                }
                else {
                    // Otherwise, create it on top of the master branch
                    cmd_1.cmd.executeRequired(git_1.git.info.path, ['branch', '--no-track', develop.name, master.name]);
                }
                // Checkout develop since we just created it
                yield git_1.git.checkout(develop);
            }
            // Create the branch prefixes and store those in git config
            for (const what of ['bugfix', 'feature', 'release', 'hotfix', 'support']) {
                const prefix = yield vscode.window.showInputBox({
                    prompt: `Enter a prefix for "${what}" branches`,
                    value: `${what}/`,
                    validateInput: branchNonEmpty,
                });
                if (!prefix)
                    return;
                yield git_1.git.config.set(`gitflow.prefix.${what}`, prefix);
            }
            const version_tag_prefix = yield vscode.window.showInputBox({
                prompt: 'Enter a prefix for version tags (optional)',
            });
            if (version_tag_prefix === null)
                return;
            yield git_1.git.config.set('gitflow.prefix.versiontag', version_tag_prefix);
            // Set the main branches, and gitflow is officially 'enabled'
            yield git_1.git.config.set('gitflow.branch.master', master.name);
            yield git_1.git.config.set('gitflow.branch.develop', develop.name);
            console.assert(yield flowEnabled());
            vscode.window.showInformationMessage('Gitflow has been initialized for this repository!');
        });
    }
    flow.initialize = initialize;
})(flow = exports.flow || (exports.flow = {}));
(function (flow) {
    var feature;
    (function (feature) {
        /**
         * Get the feature/bugfix branch prefix
         */
        function prefix(branchType) {
            return git_1.git.config.get(`gitflow.prefix.${branchType}`);
        }
        feature.prefix = prefix;
        /**
         * Get the current feature/bugfix branch as well as its name.
         */
        function current(msg = 'Not working on a feature or bugfix branch', branchType) {
            return __awaiter(this, void 0, void 0, function* () {
                const current_branch = yield git_1.git.currentBranch();
                const prefix = yield feature.prefix(branchType);
                if (!prefix) {
                    throw flow.throwNotInitializedError();
                }
                if (!current_branch || !current_branch.name.startsWith(prefix)) {
                    throw fail_1.fail.error({ message: msg });
                }
                const name = current_branch.name.substr(prefix.length);
                return { branch: current_branch, name: name };
            });
        }
        feature.current = current;
        function precheck() {
            return __awaiter(this, void 0, void 0, function* () {
                const local_develop = yield flow.developBranch();
                const remote_develop = git_1.git.BranchRef.fromName(`origin/${local_develop.name}`);
                const local_ref = yield local_develop.ref();
                if (yield remote_develop.exists()) {
                    yield git_1.git.requireEqual(local_develop, remote_develop, true);
                }
            });
        }
        feature.precheck = precheck;
        function start(feature_name, branchType) {
            return __awaiter(this, void 0, void 0, function* () {
                console.assert(!!feature_name);
                yield flow.requireFlowEnabled();
                const prefix = yield feature.prefix(branchType);
                if (!prefix) {
                    throw flow.throwNotInitializedError();
                }
                const new_branch = git_1.git.BranchRef.fromName(`${prefix}${feature_name}`);
                yield flow.requireNoSuchBranch(new_branch, { message: `The ${branchType} "${feature_name}" already exists` });
                // Create our new branch
                const local_develop = yield flow.developBranch();
                yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['checkout', '-b', new_branch.name, local_develop.name]);
                vscode.window.showInformationMessage(`New branch "${new_branch.name}" was created`);
            });
        }
        feature.start = start;
        /**
         * Rebase the current feature branch on develop
         */
        function rebase(branchType) {
            return __awaiter(this, void 0, void 0, function* () {
                yield flow.requireFlowEnabled();
                const { branch: feature_branch } = yield current(`You must checkout the ${branchType} branch you wish to rebase on develop`, branchType);
                const remote = feature_branch.remoteAt(git_1.git.primaryRemote());
                const develop = yield flow.developBranch();
                if ((yield remote.exists()) && !(yield git_1.git.isMerged(remote, develop))) {
                    const do_rebase = !!(yield vscode.window.showWarningMessage(`A remote branch for ${feature_branch.name} exists, and rebasing ` +
                        `will rewrite history for this branch that may be visible to ` +
                        `other users!`, 'Rebase anyway'));
                    if (!do_rebase)
                        return;
                }
                yield git_1.git.requireClean();
                const result = yield git_1.git.rebase({ branch: feature_branch, onto: develop });
                if (result.retc) {
                    const abort_result = yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['rebase', '--abort']);
                    fail_1.fail.error({
                        message: `Rebase command failed with exit code ${result.retc}. ` +
                            `The rebase has been aborted: Please perform this rebase from ` +
                            `the command line and resolve the appearing errors.`
                    });
                }
                yield vscode.window.showInformationMessage(`${feature_branch.name} has been rebased onto ${develop.name}`);
            });
        }
        feature.rebase = rebase;
        function finish(branchType) {
            return __awaiter(this, void 0, void 0, function* () {
                return withProgress({
                    location: vscode.ProgressLocation.Window,
                    title: `Finishing ${branchType}`,
                }, (pr) => __awaiter(this, void 0, void 0, function* () {
                    pr.report({ message: 'Getting current branch...' });
                    const { branch: feature_branch, name: feature_name } = yield current(`You must checkout the ${branchType} branch you wish to finish`, branchType);
                    pr.report({ message: 'Checking for cleanliness...' });
                    const is_clean = yield git_1.git.isClean();
                    pr.report({ message: 'Checking for incomplete merge...' });
                    const merge_base_file = path.join(flow.gitflowDir, 'MERGE_BASE');
                    if (yield fs_1.fs.exists(merge_base_file)) {
                        const merge_base = git_1.git.BranchRef.fromName((yield fs_1.fs.readFile(merge_base_file)).toString());
                        if (is_clean) {
                            // The user must have resolved the conflict themselves, so
                            // all we need to do is delete the merge file
                            yield fs_1.fs.remove(merge_base_file);
                            if (yield git_1.git.isMerged(feature_branch, merge_base)) {
                                // The user already merged this feature branch. We'll just exit!
                                yield finishCleanup(feature_branch, branchType);
                                return;
                            }
                        }
                        else {
                            // They have an unresolved merge conflict. Tell them what they must do
                            fail_1.fail.error({
                                message: `You have merge conflicts! Resolve them before trying to finish ${branchType} branch.`
                            });
                        }
                    }
                    yield git_1.git.requireClean();
                    pr.report({ message: 'Checking remotes...' });
                    const all_branches = yield git_1.git.BranchRef.all();
                    // Make sure that the local feature and the remote feature haven't diverged
                    const remote_branch = all_branches.find(br => br.name === 'origin/' + feature_branch.name);
                    if (remote_branch) {
                        yield git_1.git.requireEqual(feature_branch, remote_branch, true);
                    }
                    // Make sure the local develop and remote develop haven't diverged either
                    const develop = yield flow.developBranch();
                    const remote_develop = git_1.git.BranchRef.fromName('origin/' + develop.name);
                    if (yield remote_develop.exists()) {
                        yield git_1.git.requireEqual(develop, remote_develop, true);
                    }
                    pr.report({ message: `Merging ${feature_branch.name} into ${develop}...` });
                    // Switch to develop and merge in the feature branch
                    yield git_1.git.checkout(develop);
                    const result = yield cmd_1.cmd.execute(git_1.git.info.path, ['merge', '--no-ff', feature_branch.name]);
                    if (result.retc) {
                        // Merge conflict. Badness
                        yield fs_1.fs.writeFile(flow.gitflowDir, develop.name);
                        fail_1.fail.error({
                            message: `There were conflicts while merging into ${develop.name}. Fix the issues before trying to finish the ${branchType} branch`
                        });
                    }
                    pr.report({ message: 'Cleaning up...' });
                    yield finishCleanup(feature_branch, branchType);
                }));
            });
        }
        feature.finish = finish;
        function finishCleanup(branch, branchType) {
            return __awaiter(this, void 0, void 0, function* () {
                console.assert(yield branch.exists());
                console.assert(yield git_1.git.isClean());
                const origin = git_1.git.RemoteRef.fromName('origin');
                const remote = git_1.git.BranchRef.fromName(origin.name + '/' + branch.name);
                if (config_1.config.deleteBranchOnFinish) {
                    if (config_1.config.deleteRemoteBranches && (yield remote.exists())) {
                        // Delete the branch on the remote
                        yield git_1.git.push(git_1.git.RemoteRef.fromName('origin'), git_1.git.BranchRef.fromName(`:refs/heads/${branch.name}`));
                    }
                    yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['branch', '-d', branch.name]);
                }
                vscode.window.showInformationMessage(`${branchType.substring(0, 1).toUpperCase()}${branchType.substring(1)} branch ${branch.name} has been closed`);
            });
        }
    })(feature = flow.feature || (flow.feature = {}));
})(flow = exports.flow || (exports.flow = {}));
(function (flow) {
    var release;
    (function (release) {
        function current() {
            return __awaiter(this, void 0, void 0, function* () {
                const branches = yield git_1.git.BranchRef.all();
                const prefix = yield flow.releasePrefix();
                if (!prefix) {
                    throw flow.throwNotInitializedError();
                }
                return branches.find(br => br.name.startsWith(prefix));
            });
        }
        release.current = current;
        function precheck() {
            return __awaiter(this, void 0, void 0, function* () {
                yield git_1.git.requireClean();
                const develop = yield flow.developBranch();
                const remote_develop = develop.remoteAt(git_1.git.primaryRemote());
                if (yield remote_develop.exists()) {
                    yield git_1.git.requireEqual(develop, remote_develop);
                }
            });
        }
        release.precheck = precheck;
        /**
         * Get the tag for a new release branch
         */
        function guess_new_version() {
            return __awaiter(this, void 0, void 0, function* () {
                const tag = git_1.git.TagRef.fromName("_start_new_release");
                const tag_prefix = (yield flow.tagPrefix()) || '';
                let version_tag = (yield tag.latest()) || '0.0.0';
                version_tag = version_tag.replace(tag_prefix, '');
                if (version_tag.match(/^\d+\.\d+\.\d+$/)) {
                    let version_numbers = version_tag.split('.');
                    version_numbers[1] = String(Number(version_numbers[1]) + 1);
                    version_numbers[2] = "0";
                    version_tag = version_numbers.join('.');
                }
                return version_tag;
            });
        }
        release.guess_new_version = guess_new_version;
        function start(name) {
            return __awaiter(this, void 0, void 0, function* () {
                yield flow.requireFlowEnabled();
                const current_release = yield release.current();
                if (!!current_release) {
                    fail_1.fail.error({
                        message: `There is an existing release branch "${current_release.name}". Finish that release before starting a new one.`
                    });
                }
                const tag = git_1.git.TagRef.fromName(name);
                if (yield tag.exists()) {
                    fail_1.fail.error({
                        message: `The tag "${name}" is an existing tag. Please chose another release name.`
                    });
                }
                const prefix = yield flow.releasePrefix();
                const new_branch = git_1.git.BranchRef.fromName(`${prefix}${name}`);
                const develop = yield flow.developBranch();
                yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['checkout', '-b', new_branch.name, develop.name]);
                yield vscode.window.showInformationMessage(`New branch ${new_branch.name} has been created. ` +
                    `Now is the time to update your version numbers and fix any ` +
                    `last minute bugs.`);
            });
        }
        release.start = start;
        function finish() {
            return __awaiter(this, void 0, void 0, function* () {
                yield flow.requireFlowEnabled();
                const prefix = yield flow.releasePrefix();
                if (!prefix) {
                    throw flow.throwNotInitializedError();
                }
                const current_release = yield release.current();
                if (!current_release) {
                    throw fail_1.fail.error({ message: 'No active release branch to finish' });
                }
                yield finalizeWithBranch(prefix, current_release, finish);
            });
        }
        release.finish = finish;
        function finalizeWithBranch(rel_prefix, branch, reenter) {
            return __awaiter(this, void 0, void 0, function* () {
                return withProgress({
                    location: vscode.ProgressLocation.Window,
                    title: 'Finishing release branch'
                }, (pr) => __awaiter(this, void 0, void 0, function* () {
                    yield flow.requireFlowEnabled();
                    pr.report({ message: 'Getting current branch...' });
                    const current_branch = yield git_1.git.currentBranch();
                    if (!current_branch) {
                        throw fail_1.fail.error({ message: 'Unable to detect a current git branch.' });
                    }
                    if (current_branch.name !== branch.name) {
                        fail_1.fail.error({
                            message: `You are not currently on the "${branch.name}" branch`,
                            handlers: [{
                                    title: `Checkout ${branch.name} and continue.`,
                                    cb: function () {
                                        return __awaiter(this, void 0, void 0, function* () {
                                            yield git_1.git.checkout(branch);
                                            yield reenter();
                                        });
                                    }
                                }]
                        });
                    }
                    pr.report({ message: 'Checking cleanliness...' });
                    yield git_1.git.requireClean();
                    pr.report({ message: 'Checking remotes...' });
                    const master = yield flow.masterBranch();
                    const remote_master = master.remoteAt(git_1.git.primaryRemote());
                    if (yield remote_master.exists()) {
                        yield git_1.git.requireEqual(master, remote_master);
                    }
                    const develop = yield flow.developBranch();
                    const remote_develop = develop.remoteAt(git_1.git.primaryRemote());
                    if (yield remote_develop.exists()) {
                        yield git_1.git.requireEqual(develop, remote_develop);
                    }
                    // Get the name of the tag we will use. Default is the branch's flow name
                    pr.report({ message: 'Getting a tag message...' });
                    const tag_message = yield vscode.window.showInputBox({
                        prompt: 'Enter a tag message (optional)',
                    });
                    if (tag_message === undefined)
                        return;
                    // Now the crux of the logic, after we've done all our sanity checking
                    pr.report({ message: 'Switching to master...' });
                    yield git_1.git.checkout(master);
                    // Merge the branch into the master branch
                    if (!(yield git_1.git.isMerged(branch, master))) {
                        pr.report({ message: `Merging ${branch} into ${master}...` });
                        yield git_1.git.merge(branch);
                    }
                    // Create a tag for the release
                    const tag_prefix = (yield flow.tagPrefix()) || '';
                    const release_name = tag_prefix.concat(branch.name.substr(rel_prefix.length));
                    pr.report({ message: `Tagging ${master}: ${release_name}...` });
                    yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['tag', '-m', tag_message, release_name, master.name]);
                    // Merge the release into develop
                    pr.report({ message: `Checking out ${develop}...` });
                    yield git_1.git.checkout(develop);
                    if (!(yield git_1.git.isMerged(branch, develop))) {
                        pr.report({ message: `Merging ${branch} into ${develop}...` });
                        yield git_1.git.merge(branch);
                    }
                    if (config_1.config.deleteBranchOnFinish) {
                        // Delete the release branch
                        pr.report({ message: `Deleting ${branch.name}...` });
                        yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['branch', '-d', branch.name]);
                        if (config_1.config.deleteRemoteBranches && (yield remote_develop.exists()) &&
                            (yield remote_master.exists())) {
                            const remote = git_1.git.primaryRemote();
                            pr.report({ message: `Pushing to ${remote.name}/${develop.name}...` });
                            yield git_1.git.push(remote, develop);
                            pr.report({ message: `Pushing to ${remote.name}/${master.name}...` });
                            yield git_1.git.push(remote, master);
                            const remote_branch = branch.remoteAt(remote);
                            pr.report({ message: `Pushing tag ${release_name}...` });
                            cmd_1.cmd.executeRequired(git_1.git.info.path, ['push', '--tags', remote.name]);
                            if (yield remote_branch.exists()) {
                                // Delete the remote branch
                                pr.report({ message: `Deleting remote ${remote.name}/${branch.name}` });
                                yield git_1.git.push(remote, git_1.git.BranchRef.fromName(':' + branch.name));
                            }
                        }
                    }
                    vscode.window.showInformationMessage(`The release "${release_name}" has been created. You are now on the ${develop.name} branch.`);
                }));
            });
        }
        release.finalizeWithBranch = finalizeWithBranch;
    })(release = flow.release || (flow.release = {}));
})(flow = exports.flow || (exports.flow = {}));
(function (flow) {
    var hotfix;
    (function (hotfix) {
        /**
         * Get the hotfix branch prefix
         */
        function prefix() {
            return git_1.git.config.get('gitflow.prefix.hotfix');
        }
        hotfix.prefix = prefix;
        /**
         * Get the current hotfix branch, or null if there is nonesuch
         */
        function current() {
            return __awaiter(this, void 0, void 0, function* () {
                const branches = yield git_1.git.BranchRef.all();
                const prefix = yield hotfix.prefix();
                if (!prefix) {
                    throw flow.throwNotInitializedError();
                }
                return branches.find(br => br.name.startsWith(prefix));
            });
        }
        hotfix.current = current;
        /**
         * Get the tag for a new hotfix branch
         */
        function guess_new_version() {
            return __awaiter(this, void 0, void 0, function* () {
                const tag = git_1.git.TagRef.fromName("_start_new_hotfix");
                const tag_prefix = (yield flow.tagPrefix()) || '';
                let version_tag = (yield tag.latest()) || '0.0.0';
                version_tag = version_tag.replace(tag_prefix, '');
                if (version_tag.match(/^\d+\.\d+\.\d+$/)) {
                    let version_numbers = version_tag.split('.');
                    version_numbers[2] = String(Number(version_numbers[2]) + 1);
                    version_tag = version_numbers.join('.');
                }
                return version_tag;
            });
        }
        hotfix.guess_new_version = guess_new_version;
        function start(name) {
            return __awaiter(this, void 0, void 0, function* () {
                yield flow.requireFlowEnabled();
                const current_hotfix = yield current();
                if (!!current_hotfix) {
                    fail_1.fail.error({
                        message: `There is an existing hotfix branch "${current_hotfix.name}". Finish that one first.`
                    });
                }
                yield git_1.git.requireClean();
                const master = yield flow.masterBranch();
                const remote_master = master.remoteAt(git_1.git.primaryRemote());
                if (yield remote_master.exists()) {
                    yield git_1.git.requireEqual(master, remote_master);
                }
                const tag = git_1.git.TagRef.fromName(name);
                if (yield tag.exists()) {
                    fail_1.fail.error({
                        message: `The tag "${tag.name}" is an existing tag. Choose another hotfix name.`
                    });
                }
                const prefix = yield hotfix.prefix();
                const new_branch = git_1.git.BranchRef.fromName(`${prefix}${name}`);
                if (yield new_branch.exists()) {
                    fail_1.fail.error({ message: `"${new_branch.name}" is the name of an existing branch` });
                }
                yield cmd_1.cmd.executeRequired(git_1.git.info.path, ['checkout', '-b', new_branch.name, master.name]);
            });
        }
        hotfix.start = start;
        function finish() {
            return __awaiter(this, void 0, void 0, function* () {
                yield flow.requireFlowEnabled();
                const prefix = yield hotfix.prefix();
                if (!prefix) {
                    throw flow.throwNotInitializedError();
                }
                const current_hotfix = yield hotfix.current();
                if (!current_hotfix) {
                    throw fail_1.fail.error({ message: 'No active hotfix branch to finish' });
                }
                yield flow.release.finalizeWithBranch(prefix, current_hotfix, finish);
            });
        }
        hotfix.finish = finish;
    })(hotfix = flow.hotfix || (flow.hotfix = {}));
})(flow = exports.flow || (exports.flow = {}));
//# sourceMappingURL=flow.js.map