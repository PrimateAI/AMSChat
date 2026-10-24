# AMSChat

A small chat page for a Qwen3.5-9B model that runs on a home PC with
[llama.cpp](https://github.com/ggml-org/llama.cpp). This repo is only the static web page,
served by GitHub Pages at **https://primateai.github.io/AMSChat**; the model and server stay
on the owner's computer and are reached through a Tailscale Funnel address set in `config.js`.

- Streams replies, with an optional "Think first" mode that shows the model's reasoning.
- Shows when the host PC is offline; at most two chats run at once.
- No accounts, keys or storage: the page keeps the conversation in memory only.

To point the page at another llama-server for testing, open it with `?api=https://your-server`.
