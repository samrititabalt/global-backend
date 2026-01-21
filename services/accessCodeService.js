const ACCESS_CODE_REGEX = /^\d{5}$/;

const isValidAccessCode = (code) => ACCESS_CODE_REGEX.test(String(code || '').trim());

const generateRandomAccessCode = () => {
  return Math.floor(Math.random() * 100000).toString().padStart(5, '0');
};

const isAccessCodeAvailable = async (code, { excludeUserId = null, excludeEmployeeId = null } = {}) => {
  const User = require('../models/User');
  const HiringEmployee = require('../models/HiringEmployee');
  if (!isValidAccessCode(code)) return false;
  const userMatch = await User.findOne({
    accessCode: code,
    ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {})
  }).lean();
  if (userMatch) return false;

  const employeeMatch = await HiringEmployee.findOne({
    accessCode: code,
    ...(excludeEmployeeId ? { _id: { $ne: excludeEmployeeId } } : {})
  }).lean();

  return !employeeMatch;
};

const generateUniqueAccessCode = async (options = {}) => {
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateRandomAccessCode();
    if (await isAccessCodeAvailable(code, options)) {
      return code;
    }
  }
  throw new Error('Unable to generate unique access code');
};

const ensureUserAccessCode = async (user) => {
  if (!user || user.role === 'admin') return user;
  if (!user.accessCode) {
    user.accessCode = await generateUniqueAccessCode({ excludeUserId: user._id });
    await user.save();
  }
  return user;
};

const ensureEmployeeAccessCode = async (employee) => {
  if (!employee) return employee;
  if (!employee.accessCode) {
    employee.accessCode = await generateUniqueAccessCode({ excludeEmployeeId: employee._id });
    await employee.save();
  }
  return employee;
};

module.exports = {
  isValidAccessCode,
  generateUniqueAccessCode,
  isAccessCodeAvailable,
  ensureUserAccessCode,
  ensureEmployeeAccessCode
};
