const requireSaasMode = (req, res, next) => {
  if (process.env.APP_MODE !== "saas") {
    return res.status(404).json({
      success: false,
      message: "Billing is disabled in self-hosted mode.",
    });
  }
  next();
};

export default requireSaasMode;
