module.exports = {
  apps: [{
    name: 'maintenance-api',
    script: 'dist/src/main.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      // Production-only configuration
      NODE_ENV: 'production',
      PORT: 22273,
      API_PREFIX: '',
      DB_HOST: '10.10.10.181',
      DB_PORT: 5432,
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'itask@2025',
      DB_NAME: 'maintenance',
      DATABASE_URL: 'postgresql://postgres:itask@2025@10.10.10.181:5432/maintenance?schema=public',
      JWT_SECRET: 'your-super-secret-jwt-key',
      CRON_TIMEZONE: 'Asia/Baghdad',
      CRON_MONTHLY_ATTENDANCE_ENABLED: 'false',
      CRON_MONTHLY_EXPRESSION: '0 0 1 * *',
      CRON_DAILY_VALIDATION_ENABLED: 'true',
      CRON_DAILY_EXPRESSION: '59 23 * * *',
      CRON_EXCEPTION_RESTORATION_ENABLED: 'true',
      CRON_EXCEPTION_RESTORATION_EXPRESSION: '1 0 * * *',
      ZKTECO_PROCESSING_CRON: '*/10 * * * *',
      ZKTECO_INTELLIGENT_STATE_DETECTION: 'true'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
}; 