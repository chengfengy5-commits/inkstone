#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)
SYSTEMD_DIRECTORY=${SYSTEMD_DIRECTORY:-/etc/systemd/system}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}
CUTOVER_STATE_FILE=${CUTOVER_STATE_FILE:-/var/lib/inkstone-learning-library-cutover/state}

UNIFIED_SERVICE=inkstone-tech-digest.service
UNIFIED_TIMER=inkstone-tech-digest.timer
LEGACY_GITHUB_TIMER=inkstone-github-trending.timer
LEGACY_AI_TIMER=inkstone-ai-frontier.timer

fail() {
  printf 'learning-library-cutover: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ] && [ "${ALLOW_NON_ROOT_FOR_TESTS:-}" != "1" ]; then
    fail 'apply and rollback require root privileges'
  fi
}

unit_state() {
  state=$("$SYSTEMCTL_BIN" is-enabled "$1" 2>/dev/null || true)
  case "$state" in
    enabled|enabled-runtime|linked|linked-runtime) printf 'enabled\n' ;;
    masked|masked-runtime) printf 'masked\n' ;;
    static|indirect|generated|transient) printf '%s\n' "$state" ;;
    disabled) printf 'disabled\n' ;;
    *) printf 'not-found\n' ;;
  esac
}

read_state() {
  key=$1
  sed -n "s/^${key}=//p" "$CUTOVER_STATE_FILE" | sed -n '1p'
}

record_original_state() {
  if [ -f "$CUTOVER_STATE_FILE" ]; then
    return
  fi
  state_directory=$(dirname -- "$CUTOVER_STATE_FILE")
  install -d -m 0750 "$state_directory"
  backup_directory="$state_directory/cutover-backup-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 0700 "$backup_directory"

  service_backed_up=no
  timer_backed_up=no
  if [ -f "$SYSTEMD_DIRECTORY/$UNIFIED_SERVICE" ]; then
    cp "$SYSTEMD_DIRECTORY/$UNIFIED_SERVICE" "$backup_directory/$UNIFIED_SERVICE"
    service_backed_up=yes
  fi
  if [ -f "$SYSTEMD_DIRECTORY/$UNIFIED_TIMER" ]; then
    cp "$SYSTEMD_DIRECTORY/$UNIFIED_TIMER" "$backup_directory/$UNIFIED_TIMER"
    timer_backed_up=yes
  fi

  temporary_state="$CUTOVER_STATE_FILE.$$.tmp"
  umask 077
  {
    printf 'BACKUP_DIRECTORY=%s\n' "$backup_directory"
    printf 'SERVICE_BACKED_UP=%s\n' "$service_backed_up"
    printf 'TIMER_BACKED_UP=%s\n' "$timer_backed_up"
    printf 'UNIFIED_TIMER_STATE=%s\n' "$(unit_state "$UNIFIED_TIMER")"
    printf 'LEGACY_GITHUB_TIMER_STATE=%s\n' "$(unit_state "$LEGACY_GITHUB_TIMER")"
    printf 'LEGACY_AI_TIMER_STATE=%s\n' "$(unit_state "$LEGACY_AI_TIMER")"
  } > "$temporary_state"
  mv "$temporary_state" "$CUTOVER_STATE_FILE"
}

validate_saved_state() {
  [ -f "$CUTOVER_STATE_FILE" ] || fail "missing cutover state: $CUTOVER_STATE_FILE"
  backup_directory=$(read_state BACKUP_DIRECTORY)
  [ -n "$backup_directory" ] && [ -d "$backup_directory" ] || fail 'cutover backup directory is missing'
  if [ "$(read_state SERVICE_BACKED_UP)" = 'yes' ]; then
    [ -f "$backup_directory/$UNIFIED_SERVICE" ] || fail 'backed-up service unit is missing'
  fi
  if [ "$(read_state TIMER_BACKED_UP)" = 'yes' ]; then
    [ -f "$backup_directory/$UNIFIED_TIMER" ] || fail 'backed-up timer unit is missing'
  fi
  for key in UNIFIED_TIMER_STATE LEGACY_GITHUB_TIMER_STATE LEGACY_AI_TIMER_STATE; do
    [ -n "$(read_state "$key")" ] || fail "cutover state lacks $key"
  done
}

disable_if_present() {
  if [ "$(unit_state "$1")" != 'not-found' ]; then
    "$SYSTEMCTL_BIN" disable --now "$1"
  fi
}

assert_state() {
  actual=$(unit_state "$1")
  [ "$actual" = "$2" ] || fail "$1 expected $2 but is $actual"
}

apply_cutover() {
  require_root
  record_original_state
  validate_saved_state
  install -d -m 0755 "$SYSTEMD_DIRECTORY"
  install -m 0644 "$REPOSITORY_ROOT/deploy/systemd/$UNIFIED_SERVICE" "$SYSTEMD_DIRECTORY/$UNIFIED_SERVICE"
  install -m 0644 "$REPOSITORY_ROOT/deploy/systemd/$UNIFIED_TIMER" "$SYSTEMD_DIRECTORY/$UNIFIED_TIMER"
  "$SYSTEMCTL_BIN" daemon-reload
  disable_if_present "$LEGACY_GITHUB_TIMER"
  disable_if_present "$LEGACY_AI_TIMER"
  "$SYSTEMCTL_BIN" enable --now "$UNIFIED_TIMER"
  assert_state "$UNIFIED_TIMER" enabled
  if [ "$(unit_state "$LEGACY_GITHUB_TIMER")" != 'not-found' ]; then assert_state "$LEGACY_GITHUB_TIMER" disabled; fi
  if [ "$(unit_state "$LEGACY_AI_TIMER")" != 'not-found' ]; then assert_state "$LEGACY_AI_TIMER" disabled; fi
  printf 'learning-library-cutover: unified timer enabled; legacy timers disabled\n'
}

restore_timer_state() {
  unit=$1
  previous=$2
  case "$previous" in
    enabled) "$SYSTEMCTL_BIN" enable --now "$unit" ;;
    masked) "$SYSTEMCTL_BIN" mask --now "$unit" ;;
    static|indirect|generated|transient) : ;;
    disabled|not-found|'') "$SYSTEMCTL_BIN" disable --now "$unit" 2>/dev/null || true ;;
    *) fail "unsupported saved state '$previous' for $unit" ;;
  esac
}

rollback_cutover() {
  require_root
  [ -f "$CUTOVER_STATE_FILE" ] || fail "missing cutover state: $CUTOVER_STATE_FILE"
  validate_saved_state
  backup_directory=$(read_state BACKUP_DIRECTORY)
  [ -n "$backup_directory" ] || fail 'cutover state has no backup directory'

  if [ "$(read_state SERVICE_BACKED_UP)" = 'yes' ]; then
    cp "$backup_directory/$UNIFIED_SERVICE" "$SYSTEMD_DIRECTORY/$UNIFIED_SERVICE"
  fi
  if [ "$(read_state TIMER_BACKED_UP)" = 'yes' ]; then
    cp "$backup_directory/$UNIFIED_TIMER" "$SYSTEMD_DIRECTORY/$UNIFIED_TIMER"
  fi
  "$SYSTEMCTL_BIN" daemon-reload
  restore_timer_state "$UNIFIED_TIMER" "$(read_state UNIFIED_TIMER_STATE)"
  restore_timer_state "$LEGACY_GITHUB_TIMER" "$(read_state LEGACY_GITHUB_TIMER_STATE)"
  restore_timer_state "$LEGACY_AI_TIMER" "$(read_state LEGACY_AI_TIMER_STATE)"
  printf 'learning-library-cutover: previous unit files and timer states restored\n'
}

check_cutover() {
  printf '%s=%s\n' "$UNIFIED_TIMER" "$(unit_state "$UNIFIED_TIMER")"
  printf '%s=%s\n' "$LEGACY_GITHUB_TIMER" "$(unit_state "$LEGACY_GITHUB_TIMER")"
  printf '%s=%s\n' "$LEGACY_AI_TIMER" "$(unit_state "$LEGACY_AI_TIMER")"
  if [ -f "$CUTOVER_STATE_FILE" ]; then
    printf 'cutover_state=%s\n' "$CUTOVER_STATE_FILE"
  else
    printf 'cutover_state=missing\n'
  fi
}

case "${1:-}" in
  apply) apply_cutover ;;
  rollback) rollback_cutover ;;
  check) check_cutover ;;
  *) fail 'usage: install-learning-library-collector.sh apply|rollback|check' ;;
esac
