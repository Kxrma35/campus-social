pg_tool() {
  local tool="$1"
  shift
  if [ "${PG_TOOLS:-auto}" != "docker" ] && command -v "$tool" >/dev/null 2>&1; then
    "$tool" "$@"
  else
    docker run --rm -i --network host "${PG_IMAGE:-postgres:16}" "$tool" "$@"
  fi
}

die() {
  echo "error: $*" >&2
  exit 2
}
