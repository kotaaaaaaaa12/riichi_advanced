defmodule RiichiAdvancedWeb.CloudflareProxy do
  @moduledoc false
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    # The Worker overwrites this header; the container has no public ingress.
    case get_req_header(conn, "x-riichi-client-ip") do
      [address] ->
        case :inet.parse_address(String.to_charlist(address)) do
          {:ok, ip} -> %{conn | remote_ip: ip}
          _ -> conn
        end

      _ -> conn
    end
  end
end
