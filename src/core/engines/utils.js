/**
 * HTML escape/unescape helpers — host-free (plan 59 M3-3).
 * Extracted verbatim from src/background/translationService.js (Utils).
 */
export class Utils {
  /**
   * Replace the characters `& < > " '` with `&amp; &lt; &gt; &quot; &#39;`.
   * @param {string} unsafe
   * @returns {string} escapedString
   */
  static escapeHTML(unsafe) {
    return unsafe
      .replace(/\&/g, "&amp;")
      .replace(/\</g, "&lt;")
      .replace(/\>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/\'/g, "&#39;");
  }

  /**
   * Replace the characters `&amp; &lt; &gt; &quot; &#39;` with `& < > " '`.
   * @param {string} unsafe
   * @returns {string} unescapedString
   */
  static unescapeHTML(unsafe) {
    return unsafe
      .replace(/\&amp;/g, "&")
      .replace(/\&lt;/g, "<")
      .replace(/\&gt;/g, ">")
      .replace(/\&quot;/g, '"')
      .replace(/\&\#39;/g, "'");
  }
}

