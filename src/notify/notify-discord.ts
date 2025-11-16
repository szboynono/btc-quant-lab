// src/notify/notify-discord.ts
import fetch from "node-fetch";

export interface NotifyPayload {
  title: string;
  text: string;
}

/**
 * 发送 Discord Webhook 通知
 */
export async function sendDiscordNotification(payload: NotifyPayload) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn(
      "[notify-discord] 未设置 DISCORD_WEBHOOK_URL 环境变量，跳过发送通知。"
    );
    return;
  }

  const content =
    `**${payload.title}**\n` +
    "```text\n" +
    payload.text +
    "\n```";

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      console.error(
        "[notify-discord] 发送失败，HTTP 状态码:",
        res.status,
        await res.text()
      );
    } else {
      console.log("[notify-discord] Discord 通知已发送。");
    }
  } catch (err) {
    console.error("[notify-discord] 发送异常:", err);
  }
}