const requireSaasMode = (req, res, next) => {
  const appMode = String(process.env.APP_MODE || "")
    .trim()
    .toLowerCase();
  if (appMode !== "saas") {
    return res.status(404).json({
      success: false,
      message: "Billing is disabled in self-hosted mode.",
    });
  }
  next();
};

export default requireSaasMode;
