"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class BaseTemplate {
}
exports.BaseTemplate = BaseTemplate;
class BaseExpressionTemplate extends BaseTemplate {
    canUse(code) {
        // TODO: Parse code
        return true;
    }
}
exports.BaseExpressionTemplate = BaseExpressionTemplate;
//# sourceMappingURL=baseTemplates.js.map