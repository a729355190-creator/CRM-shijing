#!/bin/bash
# ============================================================
# 仕净 V6 数据库每日自动备份脚本
# 用 sqlite3 .backup 做热备份（不锁库、不影响在线业务）
# 保留 30 天，自动清理过期备份
# ============================================================
set -euo pipefail

DB_FILE="/opt/shijing-v6/db/shijing.db"
BACKUP_DIR="/opt/shijing-v6/backups/db"
KEEP_DAYS=30
TS="$(date +%Y%m%d_%H%M%S)"
DEST="${BACKUP_DIR}/shijing_${TS}.db"
LOG="/opt/shijing-v6/backups/backup.log"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

if [ ! -f "$DB_FILE" ]; then
  log "ERROR: 数据库文件不存在 $DB_FILE"
  exit 1
fi

# 热备份（sqlite3 .backup 是事务安全的在线备份）
if sqlite3 "$DB_FILE" ".backup '$DEST'"; then
  # 校验备份完整性
  if sqlite3 "$DEST" "PRAGMA integrity_check" | grep -q "^ok$"; then
    SIZE="$(du -h "$DEST" | cut -f1)"
    # 压缩节省空间
    gzip -f "$DEST"
    log "OK: 备份成功 ${DEST}.gz (原始 ${SIZE})"
  else
    log "ERROR: 备份完整性校验失败，删除损坏备份 $DEST"
    rm -f "$DEST"
    exit 1
  fi
else
  log "ERROR: sqlite3 .backup 执行失败"
  exit 1
fi

# 清理 30 天前的旧备份
DELETED="$(find "$BACKUP_DIR" -name 'shijing_*.db.gz' -mtime +${KEEP_DAYS} -print -delete | wc -l)"
[ "$DELETED" -gt 0 ] && log "CLEAN: 清理了 ${DELETED} 个超过 ${KEEP_DAYS} 天的旧备份"

# 输出当前备份概况
COUNT="$(find "$BACKUP_DIR" -name 'shijing_*.db.gz' | wc -l)"
TOTAL="$(du -sh "$BACKUP_DIR" | cut -f1)"
log "STAT: 当前共 ${COUNT} 个备份，占用 ${TOTAL}"
