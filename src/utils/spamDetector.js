const blacklist = ["scam", "click here", "free money"];

exports.detectSpam = (text = "") => {
  const lower = text.toLowerCase();

  if (blacklist.some(word => lower.includes(word))) return true;
  if ((text.match(/http/g) || []).length > 2) return true;
  if ((text.match(/!+/g) || []).length > 5) return true;

  return false;
};
