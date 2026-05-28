const mongoose = require("mongoose");
const Withdrawal = require("../models/Withdrawal");
const WalletTransaction = require("../models/WalletTransaction");
const TargetedBonusOffer = require("../models/TargetedBonusOffer");
const BonusOfferTemplate = require("../models/BonusOfferTemplate");

const ENTREPRENEUR_AUTOMATION_KEY = "entrepreneur_first_withdrawal";
const ENTREPRENEUR_TEMPLATE_KEY = "entrepreneur_default";

const DEFAULT_ENTREPRENEUR_TEMPLATE = {
  title: "Entrepreneur Application",
  description: "Pick a tier - Cash in - Get extra bonus.",
  options: [
    {
      tierTitle: "Beginner Entrepreneur",
      depositAmount: 200,
      bonusAmount: 30,
      isFull: false,
    },
    {
      tierTitle: "Advance Entrepreneur",
      depositAmount: 500,
      bonusAmount: 80,
      isFull: false,
    },
    {
      tierTitle: "Superior Entrepreneur",
      depositAmount: 1000,
      bonusAmount: 170,
      isFull: false,
    },
  ],
};

async function getEntrepreneurTemplate(session = null) {
  let template = await BonusOfferTemplate.findOne({
    key: ENTREPRENEUR_TEMPLATE_KEY,
    eventType: "entrepreneur",
  }).session(session || null);

  if (!template) {
    const created = await BonusOfferTemplate.create(
      [
        {
          key: ENTREPRENEUR_TEMPLATE_KEY,
          eventType: "entrepreneur",
          title: DEFAULT_ENTREPRENEUR_TEMPLATE.title,
          description: DEFAULT_ENTREPRENEUR_TEMPLATE.description,
          options: DEFAULT_ENTREPRENEUR_TEMPLATE.options,
          updatedByAdmin: null,
        },
      ],
      session ? { session } : {}
    );

    template = created[0];
  }

  return {
    title: String(template.title || DEFAULT_ENTREPRENEUR_TEMPLATE.title).trim(),
    description: String(
      template.description || DEFAULT_ENTREPRENEUR_TEMPLATE.description
    ).trim(),
    options:
      Array.isArray(template.options) && template.options.length > 0
        ? template.options.map((item) => ({
            tierTitle: String(item.tierTitle || "").trim(),
            depositAmount: Number(item.depositAmount || 0),
            bonusAmount: Number(item.bonusAmount || 0),
            isFull: Boolean(item.isFull),
          }))
        : DEFAULT_ENTREPRENEUR_TEMPLATE.options.map((item) => ({ ...item })),
  };
}

async function createEntrepreneurOfferAfterFirstWithdrawal({
  userId,
  withdrawalId,
  adminId = null,
  session = null,
}) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { created: false, reason: "INVALID_USER_ID" };
  }

  const cleanUserId = new mongoose.Types.ObjectId(userId);

  // ✅ Count approved withdrawals for this user
  // This should run AFTER the current withdrawal is approved.
  const approvedWithdrawalCount = await Withdrawal.countDocuments({
    user: cleanUserId,
    status: "APPROVED",
  }).session(session || null);

  // ✅ Only first ever approved withdrawal can trigger event
  if (approvedWithdrawalCount !== 1) {
    return {
      created: false,
      reason: "NOT_FIRST_APPROVED_WITHDRAWAL",
      approvedWithdrawalCount,
    };
  }

  // ✅ Prevent duplicate entrepreneur event
  const existingOffer = await TargetedBonusOffer.findOne({
    user: cleanUserId,
    eventType: "entrepreneur",
    automationKey: ENTREPRENEUR_AUTOMATION_KEY,
  }).session(session || null);

  if (existingOffer) {
    return {
      created: false,
      reason: "ENTREPRENEUR_OFFER_ALREADY_EXISTS",
      offer: existingOffer,
    };
  }

  const template = await getEntrepreneurTemplate(session);

  try {
    const created = await TargetedBonusOffer.create(
      [
        {
          user: cleanUserId,

          // ✅ Uses latest saved admin template
          title: template.title,
          description: template.description,
          options: template.options.map((item) => ({ ...item })),

          eventType: "entrepreneur",

          status: "active",
          isReserved: false,
          reservedAt: null,

          createdByAdmin: adminId || null,
          automationKey: ENTREPRENEUR_AUTOMATION_KEY,
          triggeredByWithdrawal: withdrawalId || null,
          autoCreated: true,
        },
      ],
      session ? { session } : {}
    );

    return {
      created: true,
      offer: created[0],
    };
  } catch (err) {
    // ✅ If unique index catches duplicate, do not crash approval flow
    if (err?.code === 11000) {
      return {
        created: false,
        reason: "DUPLICATE_KEY_ALREADY_EXISTS",
      };
    }

    throw err;
  }
}

async function deleteEntrepreneurOfferAfterFirstDeposit({
  userId,
  session = null,
}) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { deleted: false, reason: "INVALID_USER_ID" };
  }

  const cleanUserId = new mongoose.Types.ObjectId(userId);

  // ✅ Count first ever real deposits only
  const depositCount = await WalletTransaction.countDocuments({
    userId: cleanUserId,
    type: "DEPOSIT",
    amount: { $gt: 0 },
  }).session(session || null);

  // ✅ Only first ever deposit removes the entrepreneur event
  if (depositCount !== 1) {
    return {
      deleted: false,
      reason: "NOT_FIRST_DEPOSIT",
      depositCount,
    };
  }

  const result = await TargetedBonusOffer.deleteMany({
    user: cleanUserId,
    eventType: "entrepreneur",
    automationKey: ENTREPRENEUR_AUTOMATION_KEY,
  }).session(session || null);

  return {
    deleted: Number(result.deletedCount || 0) > 0,
    deletedCount: Number(result.deletedCount || 0),
    depositCount,
  };
}

module.exports = {
  ENTREPRENEUR_AUTOMATION_KEY,
  ENTREPRENEUR_TEMPLATE_KEY,
  DEFAULT_ENTREPRENEUR_TEMPLATE,
  getEntrepreneurTemplate,
  createEntrepreneurOfferAfterFirstWithdrawal,
  deleteEntrepreneurOfferAfterFirstDeposit,
};