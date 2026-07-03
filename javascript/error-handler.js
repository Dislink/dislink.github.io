/**
 * Dislink Tools - Global Error Handler
 * Catches JS errors and prompts users to report bugs via QQ group.
 */
(function() {
    var QQ_NUMBER = '849257426';

    function showErrorAlert(msg) {
        var shortMsg = (msg || '').toString().split('\n')[0].substring(0, 120);
        alert(
            '出现了一个错误:\n' + shortMsg + '\n\n'
            + '如果这个错误影响了工具的正常使用，请加QQ群反馈，以便作者修复。\n'
            + 'QQ群: ' + QQ_NUMBER + '\n\n'
            + '点击确定后页面可能继续工作，也可能需要刷新重试。'
        );
    }

    window.reportError = showErrorAlert;

    function handleError(msg, url, line, col, error) {
        var message = msg;
        if (error && error.stack) {
            message = error.stack;
        }
        console.error('[Dislink Error]', msg, url, line, col, error);
        showErrorAlert(msg);
        return true;
    }

    window.onerror = handleError;

    window.addEventListener('unhandledrejection', function(e) {
        var msg = e.reason ? (e.reason.message || e.reason.toString()) : 'Unknown Promise Error';
        console.error('[Dislink Unhandled Rejection]', e.reason);
        showErrorAlert(msg);
    });
})();
