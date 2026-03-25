const Question = require("../models/Question");

const createQuestion = async (req, res) => {
  try {
    const { title, body } = req.body;

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required" });
    }

    const question = await Question.create({
      title,
      body,
      authorId: req.user._id,
    });

    return res.status(201).json({
      message: "Question created successfully",
      question,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getQuestions = async (req, res) => {
  try {
    const questions = await Question.find()
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId")
      .sort({ createdAt: -1 });

    return res.json(questions);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getQuestionById = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id)
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId");

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    return res.json(question);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createQuestion,
  getQuestions,
  getQuestionById,
};
