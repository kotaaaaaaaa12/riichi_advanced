import Config

config :riichi_advanced, RiichiAdvancedWeb.Endpoint,
  server: true,
  http: [ip: {0, 0, 0, 0}, port: 4000],
  code_reloader: false,
  debug_errors: false,
  watchers: [],
  check_origin: :conn,
  force_ssl: [rewrite_on: [:x_forwarded_host, :x_forwarded_port, :x_forwarded_proto]],
  cache_static_manifest: "priv/static/cache_manifest.json"

config :riichi_advanced, dev_routes: false
config :logger, level: :info
