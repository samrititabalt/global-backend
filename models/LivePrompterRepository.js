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

const livePrompterRepositorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    documents: [documentSchema],
    linkedInUrl: { type: String, default: '' },
    audioIntroduction: { type: audioIntroSchema, default: undefined },
    /** Consolidated profile for GPT context (plain text / markdown). */
    structuredProfile: { type: String, default: '' },
    knowledgeSummaryUpdatedAt: { type: Date },
    /** Permanent user instructions appended to live prompter system prompt. */
    trainingInstructions: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('LivePrompterRepository', livePrompterRepositorySchema);
