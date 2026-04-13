const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    mimeType: { type: String, default: '' },
    cloudinaryUrl: { type: String, default: '' },
    cloudinaryPublicId: { type: String, default: '' },
    extractedText: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const audioIntroSchema = new mongoose.Schema(
  {
    cloudinaryUrl: { type: String, default: '' },
    cloudinaryPublicId: { type: String, default: '' },
    transcript: { type: String, default: '' },
    uploadedAt: { type: Date }
  },
  { _id: false }
);

const knowledgeBankSchema = new mongoose.Schema(
  {
    documents: { type: [documentSchema], default: [] },
    linkedInUrl: { type: String, default: '' },
    audioIntroduction: { type: audioIntroSchema, default: undefined },
    structuredProfile: { type: String, default: '' },
    knowledgeSummaryUpdatedAt: { type: Date }
  },
  { _id: false }
);

const livePrompterRepositorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    /** Which knowledge bank live answers use (full-screen + prompt). */
    activeMode: {
      type: String,
      enum: ['interview', 'clientMeeting'],
      default: 'interview'
    },
    interviewKnowledge: { type: knowledgeBankSchema, default: () => ({}) },
    clientMeetingKnowledge: { type: knowledgeBankSchema, default: () => ({}) },
    /** @deprecated Migrated into interviewKnowledge — kept for legacy DB reads */
    documents: { type: [documentSchema], default: undefined },
    linkedInUrl: { type: String, default: undefined },
    audioIntroduction: { type: audioIntroSchema, default: undefined },
    structuredProfile: { type: String, default: undefined },
    knowledgeSummaryUpdatedAt: { type: Date, default: undefined },
    /** Permanent user instructions appended to live prompter system prompt. */
    trainingInstructions: { type: String, default: '' },
    trainingInstructionsUpdatedAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('LivePrompterRepository', livePrompterRepositorySchema);
