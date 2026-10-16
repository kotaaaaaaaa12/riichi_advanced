import Config

if config_env() == :prod do
  secret = System.fetch_env!("SECRET_KEY_BASE")
  if byte_size(secret) < 64, do: raise("SECRET_KEY_BASE must contain at least 64 bytes")

  host = System.get_env("PHX_HOST", "localhost")
  port = System.get_env("PORT", "4000") |> String.to_integer()

  config :riichi_advanced, RiichiAdvancedWeb.Endpoint,
    server: true,
    url: [scheme: "https", host: host, port: 443],
    http: [ip: {0, 0, 0, 0}, port: port],
    secret_key_base: secret,
    check_origin: :conn
end
