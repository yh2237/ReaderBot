const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
};

const levels = {
    INFO: { color: colors.blue, label: 'INFO' },
    SUCCESS: { color: colors.green, label: 'SUCCESS' },
    WARN: { color: colors.yellow, label: 'WARN' },
    ERROR: { color: colors.red, label: 'ERROR' },
    DEBUG: { color: colors.gray, label: 'DEBUG' },
};

function formatMessage(level, message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const levelInfo = levels[level] || levels.INFO;
    return `${colors.gray}[${timestamp}]${colors.reset} ${levelInfo.color}[${levelInfo.label}]${colors.reset} ${message}`;
}

const logger = {
    info: (message) => console.log(formatMessage('INFO', message)),
    success: (message) => console.log(formatMessage('SUCCESS', message)),
    warn: (message) => console.log(formatMessage('WARN', message)),
    error: (message, error) => {
        console.error(formatMessage('ERROR', message));
        if (error) {
            if (error instanceof Error) {
                console.error(`${colors.red}${error.stack || error.message}${colors.reset}`);
            } else {
                console.error(`${colors.red}${String(error)}${colors.reset}`);
            }
        }
    },
    debug: (message) => {
        if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') {
            console.log(formatMessage('DEBUG', message));
        }
    },
};

module.exports = logger;
