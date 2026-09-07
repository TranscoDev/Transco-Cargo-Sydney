/** Backend base URL, configurable via VITE_API_URL for ngrok/deployed setups. */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
