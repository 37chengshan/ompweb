interface WindowNotificationLike {
  onclick: Notification["onclick"];
  close: () => void;
}

export interface CompletionNotificationEnvironment {
  createNotification: (title: string, options?: NotificationOptions) => WindowNotificationLike;
}

export function showCompletionNotification(
  title: string,
  body: string,
  onClick: () => void,
  environment: CompletionNotificationEnvironment = { createNotification: (nextTitle, options) => new Notification(nextTitle, options) },
): boolean {
  try {
    const notification = environment.createNotification(title, { body });
    notification.onclick = () => {
      notification.close();
      onClick();
    };
    return true;
  } catch {
    return false;
  }
}
