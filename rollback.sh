#!/bin/bash
# ============================================================
# 仕净 V6 一键回滚脚本
# 用法:
#   ./rollback.sh code [<commit>]   仅回退代码到指定提交(默认上一个提交)
#   ./rollback.sh db [<备份文件>]    仅恢复数据库(默认最新备份)
#   ./rollback.sh list              查看可回退的提交和备份
# 每个危险操作都需二次确认，自动重启 pm2
# ============================================================
set -euo pipefail

APP_DIR="/opt/shijing-v6"
DB_FILE="${APP_DIR}/db/shijing.db"
BACKUP_DIR="${APP_DIR}/backups/db"
PM2_NAME="shijing-v6"

cd "$APP_DIR"

confirm() {
  read -r -p "⚠️  $1 [输入 yes 确认]: " ans
  [ "$ans" = "yes" ] || { echo "已取消。"; exit 0; }
}

restart_app() {
  echo "重启 ${PM2_NAME} ..."
  pm2 restart "$PM2_NAME"
  sleep 3
  echo "--- 启动日志 ---"
  pm2 logs "$PM2_NAME" --lines 8 --nostream
}

case "${1:-}" in
  list)
    echo "===== 最近 10 个代码提交（可回退点）====="
    git log --oneline -10
    echo ""
    echo "===== 最近 10 个数据库备份 ====="
    ls -t "$BACKUP_DIR"/shijing_*.db.gz 2>/dev/null | head -10
    ;;

  code)
    TARGET="${2:-HEAD~1}"
    echo "将把代码回退到: $(git log --oneline -1 "$TARGET")"
    echo "当前最新提交: $(git log --oneline -1 HEAD)"
    confirm "确认回退代码？(数据库不受影响)"
    # 回退前先把当前未提交改动存一个快照，避免丢失
    git stash push -u -m "rollback-autostash-$(date +%s)" 2>/dev/null || true
    git checkout "$TARGET" -- . 2>/dev/null || git reset --hard "$TARGET"
    echo "✅ 代码已回退到 $TARGET"
    restart_app
    ;;

  db)
    LATEST="$(ls -t "$BACKUP_DIR"/shijing_*.db.gz 2>/dev/null | head -1)"
    SRC="${2:-$LATEST}"
    [ -z "$SRC" ] && { echo "未找到备份文件"; exit 1; }
    [ -f "$SRC" ] || { echo "备份文件不存在: $SRC"; exit 1; }
    echo "将用此备份恢复数据库: $SRC"
    confirm "确认恢复数据库？当前库会先被自动安全备份"
    # 恢复前先把当前库另存，绝不直接覆盖
    SAFE="${DB_FILE}.before_rollback_$(date +%Y%m%d_%H%M%S)"
    cp "$DB_FILE" "$SAFE"
    echo "当前库已安全备份到: $SAFE"
    # 解压恢复
    gunzip -c "$SRC" > "${DB_FILE}.tmp"
    if sqlite3 "${DB_FILE}.tmp" "PRAGMA integrity_check" | grep -q "^ok$"; then
      mv "${DB_FILE}.tmp" "$DB_FILE"
      echo "✅ 数据库已恢复"
      restart_app
    else
      rm -f "${DB_FILE}.tmp"
      echo "❌ 备份完整性校验失败，已中止，当前库未改动"
      exit 1
    fi
    ;;

  *)
    echo "仕净 V6 一键回滚工具"
    echo "用法:"
    echo "  ./rollback.sh list             查看可回退的提交和备份"
    echo "  ./rollback.sh code [<commit>]  回退代码(默认上一提交)，自动重启"
    echo "  ./rollback.sh db [<备份.gz>]    恢复数据库(默认最新备份)，自动重启"
    echo ""
    echo "安全保障: 回退代码会先 stash 当前改动；恢复库会先另存当前库。"
    ;;
esac
