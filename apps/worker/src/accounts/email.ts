/**
 * Outbound email through Resend plus the localized verification and reset
 * templates.
 *
 * Callers build the verification link and pass ready-made copy; this module
 * only moves a message to the provider.
 *
 * The worker keeps its own template map instead of importing the UI
 * dictionaries: those ship to the browser, while the Worker needs only the
 * copy for its two transactional messages. English is the fallback for any
 * locale the map does not know.
 */

import type { Env } from "../env";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "SaveTabs <noreply@azcom.dev>";

/** The fields Resend needs for a single transactional message. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Rendered copy for a transactional email. */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export type EmailFetch = typeof fetch;

/**
 * Post one message to Resend.
 *
 * Without `RESEND_API_KEY` (local development and tests) this resolves without
 * calling the network, so account flows keep working with email disabled.
 * `fetchImpl` is injectable so tests can assert the request offline.
 */
export async function sendEmail(
  env: Env,
  message: EmailMessage,
  fetchImpl: EmailFetch = fetch,
): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (apiKey === undefined || apiKey === "") return;

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM ?? DEFAULT_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  // Account routes keep their generic responses even when delivery fails, so
  // surface provider errors in the log instead of failing the request.
  if (!response.ok) {
    console.error("resend_send_failed", { status: response.status });
  }
}

/**
 * Send and swallow network rejections.
 *
 * Account responses are deliberately generic, so a provider outage or a DNS
 * failure must not turn a valid signup, resend or reset into a 500. The
 * failure is logged and the request completes as if the send was accepted.
 */
export async function sendEmailSafely(
  env: Env,
  message: EmailMessage,
  fetchImpl: EmailFetch = fetch,
): Promise<void> {
  try {
    await sendEmail(env, message, fetchImpl);
  } catch (error) {
    console.error("resend_send_rejected", error);
  }
}

type EmailCopy = {
  verifySubject: string;
  verifyIntro: string;
  verifyAction: string;
  verifyExpiry: string;
  resetSubject: string;
  resetIntro: string;
  resetAction: string;
  resetExpiry: string;
};

/**
 * Transactional copy for every supported UI locale.
 *
 * The wording mirrors the UI dictionaries, but it is maintained here so the
 * Worker bundle does not grow by the entire set of interface strings. Both
 * messages keep the 24-hour expiry sentence.
 */
const EMAIL_COPY: Readonly<Record<string, EmailCopy>> = {
  en: {
    verifySubject: "Verify your SaveTabs email",
    verifyIntro: "Confirm your SaveTabs email address by opening the link below.",
    verifyAction: "Verify email",
    verifyExpiry:
      "This link expires in 24 hours. If you did not create a SaveTabs account, you can ignore this email.",
    resetSubject: "Reset your SaveTabs password",
    resetIntro: "Set a new SaveTabs password by opening the link below.",
    resetAction: "Reset password",
    resetExpiry:
      "This link expires in 24 hours. If you did not request a reset, you can ignore this email.",
  },
  vi: {
    verifySubject: "Xác minh email SaveTabs của bạn",
    verifyIntro:
      "Xác nhận địa chỉ email SaveTabs bằng cách mở liên kết bên dưới.",
    verifyAction: "Xác minh email",
    verifyExpiry:
      "Liên kết này hết hạn sau 24 giờ. Nếu bạn không tạo tài khoản SaveTabs, hãy bỏ qua email này.",
    resetSubject: "Đặt lại mật khẩu SaveTabs của bạn",
    resetIntro: "Đặt mật khẩu SaveTabs mới bằng cách mở liên kết bên dưới.",
    resetAction: "Đặt lại mật khẩu",
    resetExpiry:
      "Liên kết này hết hạn sau 24 giờ. Nếu bạn không yêu cầu đặt lại, hãy bỏ qua email này.",
  },
  "zh-CN": {
    verifySubject: "验证你的 SaveTabs 邮箱",
    verifyIntro: "打开下面的链接以确认你的 SaveTabs 邮箱地址。",
    verifyAction: "验证邮箱",
    verifyExpiry: "此链接将在 24 小时后失效。如果你没有创建 SaveTabs 账户，可以忽略此邮件。",
    resetSubject: "重置你的 SaveTabs 密码",
    resetIntro: "打开下面的链接设置新的 SaveTabs 密码。",
    resetAction: "重置密码",
    resetExpiry: "此链接将在 24 小时后失效。如果你没有请求重置密码，可以忽略此邮件。",
  },
  es: {
    verifySubject: "Verifica tu correo de SaveTabs",
    verifyIntro:
      "Confirma tu dirección de correo de SaveTabs abriendo el enlace de abajo.",
    verifyAction: "Verificar correo",
    verifyExpiry:
      "Este enlace caduca en 24 horas. Si no creaste una cuenta de SaveTabs, puedes ignorar este correo.",
    resetSubject: "Restablece tu contraseña de SaveTabs",
    resetIntro:
      "Establece una nueva contraseña de SaveTabs abriendo el enlace de abajo.",
    resetAction: "Restablecer contraseña",
    resetExpiry:
      "Este enlace caduca en 24 horas. Si no solicitaste un restablecimiento, puedes ignorar este correo.",
  },
  hi: {
    verifySubject: "अपना SaveTabs ईमेल सत्यापित करें",
    verifyIntro: "नीचे दिया गया लिंक खोलकर अपना SaveTabs ईमेल पता पुष्ट करें।",
    verifyAction: "ईमेल सत्यापित करें",
    verifyExpiry:
      "यह लिंक 24 घंटे में समाप्त हो जाएगा। अगर आपने SaveTabs खाता नहीं बनाया है, तो इस ईमेल को अनदेखा कर सकते हैं।",
    resetSubject: "अपना SaveTabs पासवर्ड रीसेट करें",
    resetIntro: "नीचे दिया गया लिंक खोलकर नया SaveTabs पासवर्ड सेट करें।",
    resetAction: "पासवर्ड रीसेट करें",
    resetExpiry:
      "यह लिंक 24 घंटे में समाप्त हो जाएगा। अगर आपने रीसेट का अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा कर सकते हैं।",
  },
  ar: {
    verifySubject: "تحقّق من بريدك الإلكتروني في SaveTabs",
    verifyIntro: "أكّد عنوان بريدك الإلكتروني في SaveTabs بفتح الرابط أدناه.",
    verifyAction: "تحقّق من البريد",
    verifyExpiry:
      "تنتهي صلاحية هذا الرابط خلال 24 ساعة. إذا لم تنشئ حساب SaveTabs، يمكنك تجاهل هذه الرسالة.",
    resetSubject: "أعد تعيين كلمة مرور SaveTabs",
    resetIntro: "عيّن كلمة مرور جديدة لـ SaveTabs بفتح الرابط أدناه.",
    resetAction: "إعادة تعيين كلمة المرور",
    resetExpiry:
      "تنتهي صلاحية هذا الرابط خلال 24 ساعة. إذا لم تطلب إعادة التعيين، يمكنك تجاهل هذه الرسالة.",
  },
  pt: {
    verifySubject: "Verifique seu e-mail do SaveTabs",
    verifyIntro:
      "Confirme seu endereço de e-mail do SaveTabs abrindo o link abaixo.",
    verifyAction: "Verificar e-mail",
    verifyExpiry:
      "Este link expira em 24 horas. Se você não criou uma conta no SaveTabs, pode ignorar este e-mail.",
    resetSubject: "Redefina sua senha do SaveTabs",
    resetIntro: "Defina uma nova senha do SaveTabs abrindo o link abaixo.",
    resetAction: "Redefinir senha",
    resetExpiry:
      "Este link expira em 24 horas. Se você não solicitou uma redefinição, pode ignorar este e-mail.",
  },
  ru: {
    verifySubject: "Подтвердите свою почту SaveTabs",
    verifyIntro: "Подтвердите адрес электронной почты SaveTabs, открыв ссылку ниже.",
    verifyAction: "Подтвердить почту",
    verifyExpiry:
      "Ссылка действительна 24 часа. Если вы не создавали аккаунт SaveTabs, просто проигнорируйте это письмо.",
    resetSubject: "Сбросьте пароль SaveTabs",
    resetIntro: "Задайте новый пароль SaveTabs, открыв ссылку ниже.",
    resetAction: "Сбросить пароль",
    resetExpiry:
      "Ссылка действительна 24 часа. Если вы не запрашивали сброс, просто проигнорируйте это письмо.",
  },
  ja: {
    verifySubject: "SaveTabs のメールアドレスを確認してください",
    verifyIntro:
      "以下のリンクを開いて、SaveTabs のメールアドレスを確認してください。",
    verifyAction: "メールアドレスを確認",
    verifyExpiry:
      "このリンクは 24 時間で有効期限が切れます。SaveTabs アカウントを作成していない場合は、このメールを無視してください。",
    resetSubject: "SaveTabs のパスワードをリセット",
    resetIntro:
      "以下のリンクを開いて、新しい SaveTabs パスワードを設定してください。",
    resetAction: "パスワードをリセット",
    resetExpiry:
      "このリンクは 24 時間で有効期限が切れます。リセットをリクエストしていない場合は、このメールを無視してください。",
  },
  fr: {
    verifySubject: "Vérifiez votre e-mail SaveTabs",
    verifyIntro:
      "Confirmez votre adresse e-mail SaveTabs en ouvrant le lien ci-dessous.",
    verifyAction: "Vérifier l'e-mail",
    verifyExpiry:
      "Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte SaveTabs, vous pouvez ignorer cet e-mail.",
    resetSubject: "Réinitialisez votre mot de passe SaveTabs",
    resetIntro:
      "Définissez un nouveau mot de passe SaveTabs en ouvrant le lien ci-dessous.",
    resetAction: "Réinitialiser le mot de passe",
    resetExpiry:
      "Ce lien expire dans 24 heures. Si vous n'avez pas demandé de réinitialisation, vous pouvez ignorer cet e-mail.",
  },
  de: {
    verifySubject: "Bestätige deine SaveTabs-E-Mail",
    verifyIntro:
      "Bestätige deine SaveTabs-E-Mail-Adresse, indem du den Link unten öffnest.",
    verifyAction: "E-Mail bestätigen",
    verifyExpiry:
      "Dieser Link läuft in 24 Stunden ab. Wenn du kein SaveTabs-Konto erstellt hast, kannst du diese E-Mail ignorieren.",
    resetSubject: "Setze dein SaveTabs-Passwort zurück",
    resetIntro:
      "Lege ein neues SaveTabs-Passwort fest, indem du den Link unten öffnest.",
    resetAction: "Passwort zurücksetzen",
    resetExpiry:
      "Dieser Link läuft in 24 Stunden ab. Wenn du kein Zurücksetzen angefordert hast, kannst du diese E-Mail ignorieren.",
  },
  ko: {
    verifySubject: "SaveTabs 이메일을 인증하세요",
    verifyIntro: "아래 링크를 열어 SaveTabs 이메일 주소를 확인하세요.",
    verifyAction: "이메일 인증",
    verifyExpiry:
      "이 링크는 24시간 후에 만료됩니다. SaveTabs 계정을 만들지 않았다면 이 이메일을 무시해도 됩니다.",
    resetSubject: "SaveTabs 비밀번호를 재설정하세요",
    resetIntro: "아래 링크를 열어 새 SaveTabs 비밀번호를 설정하세요.",
    resetAction: "비밀번호 재설정",
    resetExpiry:
      "이 링크는 24시간 후에 만료됩니다. 재설정을 요청하지 않았다면 이 이메일을 무시해도 됩니다.",
  },
};

const FALLBACK_LOCALE = "en";

/** English copy is the fallback for an unknown or unsupported locale. */
function copyFor(locale: string): EmailCopy {
  return EMAIL_COPY[locale] ?? EMAIL_COPY[FALLBACK_LOCALE];
}

function buildContent(
  subject: string,
  intro: string,
  action: string,
  expiry: string,
  link: string,
): EmailContent {
  return {
    subject,
    html: [
      `<p>${intro}</p>`,
      `<p><a href="${link}">${action}</a></p>`,
      `<p>${expiry}</p>`,
    ].join("\n"),
    text: [intro, "", link, "", expiry].join("\n"),
  };
}

/** Reset copy in the account's language, with English as the fallback. */
export function resetEmail(locale: string, link: string): EmailContent {
  const copy = copyFor(locale);
  return buildContent(
    copy.resetSubject,
    copy.resetIntro,
    copy.resetAction,
    copy.resetExpiry,
    link,
  );
}

/** Verification copy in the account's language, with English as the fallback. */
export function verificationEmail(locale: string, link: string): EmailContent {
  const copy = copyFor(locale);
  return buildContent(
    copy.verifySubject,
    copy.verifyIntro,
    copy.verifyAction,
    copy.verifyExpiry,
    link,
  );
}
