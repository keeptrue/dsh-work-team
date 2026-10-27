/**
 * `@role` fallback routing for the Work Team Lead conversation.
 *
 * The Lead owns the user's keyboard, so a message that starts with `@角色` has to
 * reach that employee even when the Lead model decides to answer it itself. Every
 * helper here is pure: the Host supplies the roster and does the sending, which
 * keeps the routing rules testable without a live Agent.
 */

import { ROLES, roleForName } from './roles.js';

/**
 * `@name body`, where the body may span lines.
 *
 * The `@` is ASCII on purpose: a full-width `＠` is ordinary prose in Chinese
 * input and must keep flowing to the Lead as a normal message.
 */
const DISPATCH_PATTERN = /^\s*@(\S+)\s+([\s\S]+)$/;

/** Punctuation a human glues to a mention while still meaning the name: `@backend, 修接口`. */
const NAME_TRAILERS = /[,，:：;；、]+$/;

/** @param {unknown} value - candidate mention name. @returns {string} trimmed name without trailing punctuation. */
function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(NAME_TRAILERS, '').trim();
}

/** @param {unknown} value - candidate body. @returns {string} trimmed body. */
function cleanBody(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parse one `@role body` directive.
 *
 * Returns undefined for anything ambiguous (no name, no body, full-width `@`) so
 * the caller can leave the message untouched instead of eating it.
 *
 * @param {unknown} text - message text.
 * @returns {{ name: string, body: string } | undefined} mention and body.
 */
export function parseDispatch(text) {
  if (typeof text !== 'string') return undefined;
  const match = DISPATCH_PATTERN.exec(text);
  if (match === null) return undefined;
  const name = cleanName(match[1]);
  const body = cleanBody(match[2]);
  if (name === '' || body === '') return undefined;
  return { name, body };
}

/**
 * Resolve a mention to a built-in role: role id and alias first, then the Chinese
 * and English display names (`@阿策`, `@Ace`).
 *
 * @param {unknown} name - mention text.
 * @returns {object | undefined} role definition.
 */
export function resolveDispatchRole(name) {
  const cleaned = cleanName(name);
  if (cleaned === '') return undefined;
  const byId = roleForName(cleaned);
  if (byId !== undefined) return byId;
  const lowered = cleaned.toLowerCase();
  for (const role of ROLES) {
    if (role.zh.name === cleaned) return role;
    if (role.en.name.toLowerCase() === lowered) return role;
  }
  return undefined;
}

/**
 * Text that replaces the user's message after a successful forward. It keeps the
 * payload visible for the record, tells the Lead the work has already left the
 * room, and asks for the one thing the Lead still owes the user: a confirmation.
 *
 * @param {object} role - role definition.
 * @param {string} body - forwarded body.
 * @returns {string} receipt text.
 */
export function buildDispatchReceipt(role, body) {
  const name = role.zh.name;
  const quote = cleanBody(body);
  return `这条消息已转发给 ${name}（${role.id}，${role.zh.role}）。

转发内容：
${quote}

你只需要回一句确认（例如「已转给${name}」），不要自己执行这条任务，也不要再转发一次。`;
}

/**
 * Degraded rewrite when the send itself failed. The message never reached the
 * employee, so the Lead must take the task over instead of reporting success —
 * this text is the difference between "silently dropped" and "handled".
 *
 * @param {object} role - role definition.
 * @param {string} body - original body.
 * @param {unknown} reason - error text from the failed send.
 * @returns {string} failure text.
 */
export function buildDispatchSendFailure(role, body, reason) {
  const label = `${role.zh.name}（${role.id}）`;
  const quote = cleanBody(body);
  const why = cleanBody(typeof reason === 'string' ? reason : '') || '未知原因';
  return `转发给 ${label}失败：${why}

这条任务没有送达，不要告诉用户已经派出去了。请你自己处理（或换人重派），原文如下：
${quote}`;
}

/**
 * Degraded rewrite when the target cannot take the message yet. The original
 * body is preserved in the text so nothing the user wrote is lost.
 *
 * `starting` is the auto-formation case: the employee does exist, it is simply
 * still being hired, so telling the Lead to run `team_start` would mislead.
 *
 * @param {object} role - role definition.
 * @param {string} body - original body.
 * @param {'missing' | 'failed' | 'starting'} reason - why the forward did not happen.
 * @returns {string} fallback text.
 */
export function buildDispatchFallback(role, body, reason) {
  const label = `${role.zh.name}（${role.id}）`;
  const quote = cleanBody(body);
  let advice;
  if (reason === 'starting') {
    advice = `${label} 正在入职（自动组建进行中），这条先没有转发出去。等几秒把这条重发一次就行，不用手动 team_start，也不用换人。`;
  } else if (reason === 'failed') {
    advice = `${label} 这个工位启动失败过，同名员工在本会话里不可复用。换一个角色，或者开新会话重新组建团队，再把下面的原文转过去。`;
  } else {
    advice = `${label} 还没有入职。先用 team_start 补齐默认编制，或用 hire_teammate 让这个角色入职，再把下面的原文转过去。`;
  }
  return `这条 @ 消息暂时没有转发出去：${advice}

原文（先留着，别丢，也别自己去做）：
${quote}`;
}
