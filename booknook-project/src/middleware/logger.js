// Structured request logger — output goes to App Service log stream
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const log = {
      ts: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    };
    // 5xx errors → stderr so App Insights / Log Analytics picks them up as errors
    if (res.statusCode >= 500) {
      console.error(JSON.stringify(log));
    } else {
      console.log(JSON.stringify(log));
    }
  });
  next();
}

module.exports = { requestLogger };
