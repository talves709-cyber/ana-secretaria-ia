# Backup diário do Postgres: pg_dump + rclone para fora da VPS, agendado por cron.
FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends rclone cron tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backup.sh /backup.sh
COPY entrypoint.sh /entrypoint.sh
COPY crontab /etc/cron.d/ana-backup
RUN sed -i 's/\r$//' /backup.sh /entrypoint.sh /etc/cron.d/ana-backup \
    && chmod 0755 /backup.sh /entrypoint.sh \
    && chmod 0644 /etc/cron.d/ana-backup

ENTRYPOINT ["/entrypoint.sh"]
