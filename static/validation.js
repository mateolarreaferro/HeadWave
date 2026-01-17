/**
 * Client-side Code Validation for HeadWave
 * Provides instant validation without LLM calls
 */

const CodeValidator = {
  /**
   * Validate p5.js code structure and common errors
   * @param {string} code - The p5.js code to validate
   * @returns {Object} - { valid: boolean, issues: Array, canRun: boolean }
   */
  validate: function(code) {
    const issues = [];

    if (!code || typeof code !== 'string') {
      return {
        valid: false,
        issues: [{ severity: 'error', message: 'No code provided' }],
        canRun: false
      };
    }

    // Check for function(p) wrapper
    if (!code.includes('function') || !code.includes('(p)')) {
      issues.push({
        severity: 'error',
        message: 'Missing function(p) wrapper - code must be in p5.js instance mode',
        fix: 'Wrap code in: function(p) { ... }'
      });
    }

    // Check for p.setup
    if (!code.includes('p.setup')) {
      issues.push({
        severity: 'warning',
        message: 'Missing p.setup function',
        fix: 'Add p.setup = function() { p.createCanvas(400, 400); };'
      });
    }

    // Check for p.draw
    if (!code.includes('p.draw')) {
      issues.push({
        severity: 'error',
        message: 'Missing p.draw function - nothing will be rendered',
        fix: 'Add p.draw = function() { /* drawing code */ };'
      });
    }

    // Check for p.createCanvas in setup
    if (code.includes('p.setup') && !code.includes('createCanvas')) {
      issues.push({
        severity: 'warning',
        message: 'No createCanvas call found in setup',
        fix: 'Add p.createCanvas(400, 400); in setup'
      });
    }

    // Check for getParam without default value
    const getParamRegex = /p\.getParam\s*\(\s*['"][^'"]+['"]\s*\)(?!\s*\|\|)/g;
    const unsafeGetParams = code.match(getParamRegex);
    if (unsafeGetParams) {
      issues.push({
        severity: 'warning',
        message: `${unsafeGetParams.length} getParam() call(s) without default value`,
        fix: 'Use p.getParam("name") || defaultValue'
      });
    }

    // Check for potential division by zero
    const divisionPatterns = [
      /\/\s*0[^\d]/,                    // Direct division by 0
      /\/\s*\w+\s*(?![|&])/             // Division by variable without safety check
    ];
    for (const pattern of divisionPatterns) {
      if (pattern.test(code)) {
        issues.push({
          severity: 'warning',
          message: 'Potential division by zero risk',
          fix: 'Add safety checks: x / (y || 1) or Math.max(y, 0.001)'
        });
        break;
      }
    }

    // Check for undefined variable patterns (common typos)
    const commonTypos = [
      { pattern: /\bundefined\b/, message: 'Reference to undefined' },
      { pattern: /\bNaN\b/, message: 'NaN value detected' },
      { pattern: /p5\./g, message: 'Using p5. instead of p. (should use instance mode)' }
    ];

    for (const { pattern, message } of commonTypos) {
      if (pattern.test(code)) {
        issues.push({
          severity: 'warning',
          message: message
        });
      }
    }

    // Check bracket balance
    const brackets = { '(': 0, '{': 0, '[': 0 };
    const closers = { ')': '(', '}': '{', ']': '[' };

    for (const char of code) {
      if (char in brackets) brackets[char]++;
      if (char in closers) brackets[closers[char]]--;
    }

    for (const [bracket, count] of Object.entries(brackets)) {
      if (count !== 0) {
        const type = bracket === '(' ? 'parentheses' : bracket === '{' ? 'braces' : 'brackets';
        issues.push({
          severity: 'error',
          message: `Unbalanced ${type}: ${Math.abs(count)} ${count > 0 ? 'unclosed' : 'extra closing'}`,
          fix: `Check ${type} matching`
        });
      }
    }

    // Try to parse with Function constructor (syntax check only)
    try {
      new Function('return ' + code);
    } catch (e) {
      issues.push({
        severity: 'error',
        message: `Syntax error: ${e.message}`,
        fix: 'Check code syntax'
      });
    }

    // Determine if code can run (no critical errors)
    const hasErrors = issues.some(i => i.severity === 'error');

    return {
      valid: issues.length === 0,
      issues: issues,
      canRun: !hasErrors
    };
  },

  /**
   * Quick check if code is likely valid (fast path)
   * @param {string} code - The code to check
   * @returns {boolean}
   */
  quickCheck: function(code) {
    if (!code) return false;

    // Must have basic structure
    const hasFunction = code.includes('function');
    const hasSetup = code.includes('p.setup') || code.includes('setup');
    const hasDraw = code.includes('p.draw') || code.includes('draw');

    // Try syntax parse
    try {
      new Function('return ' + code);
      return hasFunction && (hasSetup || hasDraw);
    } catch (e) {
      return false;
    }
  },

  /**
   * Extract parameter definitions from code
   * @param {string} code - The code to analyze
   * @returns {Array} - Array of { name, hasDefault, defaultValue }
   */
  extractParams: function(code) {
    const params = [];
    const paramRegex = /p\.getParam\s*\(\s*['"]([^'"]+)['"]\s*\)(?:\s*\|\|\s*([^;,\n\)]+))?/g;

    let match;
    while ((match = paramRegex.exec(code)) !== null) {
      const name = match[1];
      const defaultExpr = match[2];

      // Check if we already have this param
      if (!params.find(p => p.name === name)) {
        params.push({
          name: name,
          hasDefault: !!defaultExpr,
          defaultValue: defaultExpr ? defaultExpr.trim() : null
        });
      }
    }

    return params;
  },

  /**
   * Estimate code complexity (for performance warnings)
   * @param {string} code - The code to analyze
   * @returns {Object} - { score, warnings }
   */
  estimateComplexity: function(code) {
    let score = 0;
    const warnings = [];

    // Count nested loops
    const forLoops = (code.match(/\bfor\s*\(/g) || []).length;
    const whileLoops = (code.match(/\bwhile\s*\(/g) || []).length;
    const totalLoops = forLoops + whileLoops;

    score += totalLoops * 2;
    if (totalLoops > 3) {
      warnings.push(`${totalLoops} loops may impact performance`);
    }

    // Check for nested loops (high impact)
    const nestedLoopPattern = /for\s*\([^)]*\)\s*\{[^}]*for\s*\(/;
    if (nestedLoopPattern.test(code)) {
      score += 5;
      warnings.push('Nested loops detected - may cause performance issues');
    }

    // Count drawing operations
    const drawCalls = (code.match(/p\.(ellipse|rect|line|point|triangle|quad|arc|vertex|bezier|curve|text|image)/g) || []).length;
    score += drawCalls * 0.5;

    // Check for object creation in draw
    if (code.includes('p.draw') && (
      code.includes('new ') ||
      code.includes('[]') ||
      code.includes('{}')
    )) {
      score += 3;
      warnings.push('Object creation in draw() may cause GC pauses');
    }

    // Check for noise/random calls (expensive)
    const noiseCalls = (code.match(/p\.(noise|random)/g) || []).length;
    if (noiseCalls > 10) {
      score += noiseCalls * 0.2;
      warnings.push(`${noiseCalls} noise/random calls per frame`);
    }

    return {
      score: Math.round(score),
      level: score < 5 ? 'low' : score < 15 ? 'medium' : 'high',
      warnings: warnings
    };
  }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CodeValidator;
}
