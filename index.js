const express = require('express');
const cors = require('cors');
const app = express();
const multer = require('multer');
const path = require('path');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 8000;
require('dotenv').config();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

const upload = multer({ storage });


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.tsxr6dp.mongodb.net/fypDB?retryWrites=true&w=majority`; // ADD fypDB to URI

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const usersCollection = client.db("fypDB").collection("users");
    const projectsCollection = client.db("fypDB").collection("projects");
    const applicationsCollection = client.db("fypDB").collection("applications");
    const notificationsCollection = client.db("fypDB").collection("notifications");
    const submissionsCollection = client.db("fypDB").collection("submissions");
    const logbooksCollection = client.db("fypDB").collection("logbooks");




    app.post('/users', async (req, res) => {
      try {
        const user = req.body;


        const existingUser = await usersCollection.findOne({
          firebaseUid: user.firebaseUid
        });

        if (existingUser) {
          return res.send({ message: 'User already exists' });
        }

        // insert new user
        const result = await usersCollection.insertOne({
          firebaseUid: user.firebaseUid,
          email: user.email,
          name: user.name,
          userId: user.userId || "",
          role: user.role || 'student',
          createdAt: new Date()
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get user by Firebase UID
    app.get('/users/:uid', async (req, res) => {
      try {
        const uid = req.params.uid;

        const user = await usersCollection.findOne({ firebaseUid: uid });

        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        res.send(user);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // PROJECT RELATED APIS


    // Create new project (with duplicate title check)
    app.post('/projects', async (req, res) => {
      try {
        const project = req.body;

        // check duplicate title (case-insensitive)
        const existingProject = await projectsCollection.findOne({
          title: { $regex: `^${project.title}$`, $options: 'i' }
        });

        if (existingProject) {
          return res.status(400).send({ message: 'Project title already exists' });
        }

        const result = await projectsCollection.insertOne({
          title: project.title?.trim(),
          description: project.description?.trim(),
          shortDescription: project.shortDescription?.trim() || "",
          technologies: Array.isArray(project.technologies) ? project.technologies : [],
          duration: project.duration || "",
          supervisorUid: project.supervisorUid,
          supervisorName: project.supervisorName || "",
          supervisorEmail: project.supervisorEmail || "",
          status: project.status || 'open',
          createdAt: new Date()
        });

        res.send(result);

      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // Get all projects (only open projects)
    // Get all projects (with optional search)
    app.get('/projects', async (req, res) => {
      try {
        const search = req.query.search;

        let query = { status: 'open' };

        if (search) {
          query.title = { $regex: search, $options: 'i' };
        }

        const result = await projectsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get single project by id
    app.get('/projects/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const project = await projectsCollection.findOne({ _id: new ObjectId(id) });

        if (!project) {
          return res.status(404).send({ message: 'Project not found' });
        }

        res.send(project);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });




    // APPLICATION RELATED APIS



    // Student applies to a project (prevent duplicate application)
    app.post("/applications", async (req, res) => {
      const application = req.body;

      // basic validation
      if (!application?.studentUid || !application?.projectId || !application?.supervisorUid) {
        return res.status(400).send({ message: "Missing fields" });
      }

      const existing = await applicationsCollection.findOne({
        studentUid: application.studentUid,
        projectId: application.projectId
      });

      if (existing) {
        return res.status(409).send({ message: "You already applied for this project." });
      }

      const doc = {
        ...application,
        status: "pending",
        createdAt: new Date()
      };

      const result = await applicationsCollection.insertOne(doc);
      res.send(result);
    });


    app.get("/applications", async (req, res) => {
      try {
        const { studentUid, supervisorUid } = req.query;

        if (!studentUid && !supervisorUid) {
          return res.status(400).send({ message: "studentUid or supervisorUid is required" });
        }

        if (supervisorUid) {
          const apps = await applicationsCollection.aggregate([
            { $match: { supervisorUid } },

            // join project title (projectId is string, projects _id is ObjectId)
            {
              $lookup: {
                from: "projects",
                let: { pid: "$projectId" },
                pipeline: [
                  { $addFields: { _idStr: { $toString: "$_id" } } },
                  { $match: { $expr: { $eq: ["$_idStr", "$$pid"] } } },
                  { $project: { title: 1 } }
                ],
                as: "project"
              }
            },
            { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },

            // join studentId from users (match firebaseUid = studentUid)
            {
              $lookup: {
                from: "users",
                localField: "studentUid",
                foreignField: "firebaseUid",
                pipeline: [{ $project: { userId: 1, name: 1, email: 1 } }],
                as: "student"
              }
            },
            { $unwind: { path: "$student", preserveNullAndEmptyArrays: true } },

            {
              $project: {
                studentUid: 1,
                projectId: 1,
                supervisorUid: 1,
                status: 1,
                createdAt: 1,
                projectTitle: "$project.title",
                studentId: "$student.userId",
                studentName: "$student.name",
                studentEmail: "$student.email"
              }
            },

            { $sort: { createdAt: -1 } }
          ]).toArray();

          return res.send(apps);
        }

        const result = await applicationsCollection
          .find({ studentUid })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });




    // NOTIFICATION RELATED APIS



    // Supervisor: accept/reject application (update status)
    // Supervisor: accept/reject application (update status + create notification)
    app.patch('/applications/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        if (!status || !['accepted', 'rejected'].includes(status)) {
          return res.status(400).send({ message: 'Valid status is required: accepted or rejected' });
        }

        // get the application first (so we know which student to notify)
        const application = await applicationsCollection.findOne({ _id: new ObjectId(id) });
        if (!application) {
          return res.status(404).send({ message: 'Application not found' });
        }

        // update status
        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        // create notification for student
        await notificationsCollection.insertOne({
          userUid: application.studentUid,
          message: `Your application was ${status}.`,
          read: false,
          createdAt: new Date()
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // Student: get notifications
    app.get('/notifications', async (req, res) => {
      try {
        const userUid = req.query.userUid;

        if (!userUid) {
          return res.status(400).send({ message: 'userUid is required' });
        }

        const result = await notificationsCollection
          .find({ userUid })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });



    // SUBMISSION RELATED APIS


    // Student: create submission (IP1/IP2)
    app.post('/submissions', async (req, res) => {
      try {
        const submission = req.body;

        if (!submission.studentUid || !submission.projectId || !submission.type) {
          return res.status(400).send({ message: 'studentUid, projectId, and type are required' });
        }

        if (!['IP1', 'IP2'].includes(submission.type)) {
          return res.status(400).send({ message: 'type must be IP1 or IP2' });
        }

        // prevent duplicate submission type for same student+project (simple rule)
        const existing = await submissionsCollection.findOne({
          studentUid: submission.studentUid,
          projectId: submission.projectId,
          type: submission.type
        });

        if (existing) {
          return res.status(400).send({ message: `${submission.type} already submitted` });
        }

        const result = await submissionsCollection.insertOne({
          studentUid: submission.studentUid,
          projectId: submission.projectId,
          type: submission.type,
          fileUrl: submission.fileUrl || '',
          note: submission.note || '',
          feedback: '',
          createdAt: new Date()
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // Supervisor: get submissions for a project
    app.get('/submissions', async (req, res) => {
      try {
        const projectId = req.query.projectId;
        const studentUid = req.query.studentUid;

        // allow filtering by projectId OR studentUid
        let query = {};

        if (projectId) query.projectId = projectId;
        if (studentUid) query.studentUid = studentUid;

        const result = await submissionsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Supervisor: add feedback to a submission + notify student
    app.patch('/submissions/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { feedback } = req.body;

        if (!feedback) {
          return res.status(400).send({ message: 'feedback is required' });
        }

        // find submission
        const submission = await submissionsCollection.findOne({ _id: new ObjectId(id) });
        if (!submission) {
          return res.status(404).send({ message: 'Submission not found' });
        }

        // update feedback
        const result = await submissionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { feedback } }
        );

        // notify student
        await notificationsCollection.insertOne({
          userUid: submission.studentUid,
          message: `You received feedback for ${submission.type}.`,
          read: false,
          createdAt: new Date()
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // Supervisor: archive project
    app.patch('/projects/:id/archive', async (req, res) => {
      try {
        const id = req.params.id;

        const result = await projectsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: 'archived' } }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // Supervisor: delete project
    app.delete('/projects/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const result = await projectsCollection.deleteOne({
          _id: new ObjectId(id)
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });





    // LOGBOOK SUBMISSION RELATED APIS



    // Create weekly logbook (student)
    app.post('/logbooks', async (req, res) => {
      try {
        const lb = req.body;

        // required fields
        if (!lb.studentUid || !lb.projectId || typeof lb.week !== 'number' || !lb.date) {
          return res.status(400).send({ message: 'studentUid, projectId, week (number) and date are required' });
        }

        // prevent duplicate for same student + project + week
        const existing = await logbooksCollection.findOne({
          studentUid: lb.studentUid,
          projectId: lb.projectId,
          week: lb.week
        });

        if (existing) {
          return res.status(400).send({ message: `Logbook for week ${lb.week} already submitted` });
        }

        const doc = {
          studentUid: lb.studentUid,
          projectId: lb.projectId,
          week: lb.week,
          date: lb.date,
          activities: lb.activities || '',
          hours: lb.hours || 0,
          fileUrl: lb.fileUrl || '',
          remarks: lb.remarks || '',
          reviewed: false,
          supervisorFeedback: '',
          createdAt: new Date()
        };

        const result = await logbooksCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get logbooks (filter by studentUid, projectId, week)
    app.get('/logbooks', async (req, res) => {
      try {
        const { studentUid, projectId, week } = req.query;

        let query = {};
        if (studentUid) query.studentUid = studentUid;
        if (projectId) query.projectId = projectId;
        if (week) query.week = Number(week);

        const result = await logbooksCollection
          .find(query)
          .sort({ week: 1, createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Student: update logbook (only if not reviewed)
    app.patch('/logbooks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updates = req.body;

        // ensure not reviewed
        const existing = await logbooksCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).send({ message: 'Logbook not found' });
        if (existing.reviewed) return res.status(400).send({ message: 'Cannot edit logbook after review' });

        // allow fields: activities, hours, fileUrl, remarks, date
        const allowed = {};
        if (updates.activities !== undefined) allowed.activities = updates.activities;
        if (updates.hours !== undefined) allowed.hours = updates.hours;
        if (updates.fileUrl !== undefined) allowed.fileUrl = updates.fileUrl;
        if (updates.remarks !== undefined) allowed.remarks = updates.remarks;
        if (updates.date !== undefined) allowed.date = updates.date;

        if (Object.keys(allowed).length === 0) {
          return res.status(400).send({ message: 'No valid fields to update' });
        }

        const result = await logbooksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: allowed }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Supervisor: review a logbook (add feedback + mark reviewed) and notify student
    app.patch('/logbooks/:id/review', async (req, res) => {
      try {
        const id = req.params.id;
        const { feedback } = req.body;

        if (feedback === undefined) return res.status(400).send({ message: 'feedback is required' });

        // find logbook
        const logbook = await logbooksCollection.findOne({ _id: new ObjectId(id) });
        if (!logbook) return res.status(404).send({ message: 'Logbook not found' });

        // update reviewed and feedback
        const result = await logbooksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { reviewed: true, supervisorFeedback: feedback } }
        );

        // create notification for student (same notificationsCollection you already have)
        await notificationsCollection.insertOne({
          userUid: logbook.studentUid,
          message: `Your logbook for week ${logbook.week} has been reviewed.`,
          read: false,
          createdAt: new Date()
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Student: delete logbook (only if not reviewed)
    app.delete('/logbooks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const existing = await logbooksCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).send({ message: 'Logbook not found' });
        if (existing.reviewed) return res.status(400).send({ message: 'Cannot delete reviewed logbook' });

        const result = await logbooksCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // Upload any file (IP1/IP2/Logbook/etc.)
    app.post('/upload', upload.single('file'), (req, res) => {
      try {
        if (!req.file) return res.status(400).send({ message: 'No file uploaded' });

        const fileUrl = `/uploads/${req.file.filename}`;
        res.send({ fileUrl });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
























    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB ping successful!");

  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
  }
}
run().catch(console.dir);

// Basic route
app.get('/', (req, res) => {
  res.send('🎓 FYP Portal Server is Running');
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});