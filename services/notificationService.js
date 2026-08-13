import { Notification } from "../models/notification.model.js";

export const createNotification = ({ userId, type, title, message, link }) => {
  return Notification.create({ userId, type, title, message, link }).catch((err) =>
    console.error("Notification create failed:", err),
  );
};

export const notifyMany = ({ userIds, type, title, message, link }) => {
  if (!userIds || userIds.length === 0) return Promise.resolve();
  const docs = userIds.map((userId) => ({ userId, type, title, message, link }));
  return Notification.insertMany(docs).catch((err) =>
    console.error("Notification insertMany failed:", err),
  );
};
