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
    const completedProjectsCollection = client.db("fypDB").collection("completedProjects");




    // Save user after Firebase register
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        if (!user?.firebaseUid || !user?.email) {
          return res.status(400).send({ message: "firebaseUid and email are required" });
        }

        // avoid duplicates
        const existing = await usersCollection.findOne({ firebaseUid: user.firebaseUid });
        if (existing) {
          return res.send({ message: "User already exists" });
        }

        const result = await usersCollection.insertOne({
          firebaseUid: user.firebaseUid,
          email: user.email,
          name: user.name || "",
          userId: user.userId || "",
          role: user.role || "student",
          createdAt: new Date()
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Update user profile (student/supervisor)
    app.patch("/users/:firebaseUid", async (req, res) => {
      try {
        const firebaseUid = req.params.firebaseUid;

        const {
          faculty,
          image,
          icPassport,
          academicYear,
          currentSemester,
          studentProfile,
          supervisorProfile
        } = req.body;

        const updateDoc = {
          ...(faculty !== undefined ? { faculty } : {}),
          ...(image !== undefined ? { image } : {}),
          ...(icPassport !== undefined ? { icPassport } : {}),
          ...(academicYear !== undefined ? { academicYear } : {}),
          ...(currentSemester !== undefined ? { currentSemester } : {}),
          ...(studentProfile !== undefined ? { studentProfile } : {}),
          ...(supervisorProfile !== undefined ? { supervisorProfile } : {}),

          updatedAt: new Date()
        };

        const result = await usersCollection.updateOne(
          { firebaseUid },
          { $set: updateDoc }
        );

        res.send({ message: "Profile updated", result });
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


    app.post("/projects", async (req, res) => {
      try {
        const body = req.body;

        if (!body?.title?.trim()) {
          return res.status(400).send({ message: "Project title is required" });
        }

        const title = body.title.trim();

        // duplicate title check (case-insensitive)
        const existingProject = await projectsCollection.findOne({
          title: { $regex: `^${title}$`, $options: "i" }
        });

        if (existingProject) {
          return res.status(400).send({ message: "Project title already exists" });
        }

        const doc = {
          title,
          description: body.description?.trim() || "",
          shortDescription: body.shortDescription?.trim() || "",
          technologies: Array.isArray(body.technologies) ? body.technologies : [],
          duration: body.duration || "",
          supervisorUid: body.supervisorUid,
          supervisorName: body.supervisorName || "",
          supervisorEmail: body.supervisorEmail || "",
          status: body.status || "open",
          createdAt: new Date()
        };

        const result = await projectsCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });




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

    app.get("/projects/mine", async (req, res) => {
      try {
        const { supervisorUid } = req.query;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid is required" });
        }

        const result = await projectsCollection
          .find({ supervisorUid })
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

    // Supervisor: update my project
    app.patch("/projects/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { supervisorUid, title, description, shortDescription, technologies, duration, status } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid is required" });
        }

        // only allow owner supervisor to edit
        const project = await projectsCollection.findOne({ _id: new ObjectId(id) });
        if (!project) return res.status(404).send({ message: "Project not found" });

        if (project.supervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        // if title is being changed, check duplicate (case-insensitive)
        if (title && title.trim().toLowerCase() !== (project.title || "").toLowerCase()) {
          const existing = await projectsCollection.findOne({
            title: { $regex: `^${title.trim()}$`, $options: "i" }
          });
          if (existing) return res.status(400).send({ message: "Project title already exists" });
        }

        const updateDoc = {
          ...(title !== undefined ? { title: title.trim() } : {}),
          ...(description !== undefined ? { description: description.trim() } : {}),
          ...(shortDescription !== undefined ? { shortDescription: shortDescription.trim() } : {}),
          ...(technologies !== undefined ? { technologies: Array.isArray(technologies) ? technologies : [] } : {}),
          ...(duration !== undefined ? { duration } : {}),
          ...(status !== undefined ? { status } : {}),
          updatedAt: new Date()
        };

        const result = await projectsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateDoc }
        );

        res.send({ message: "Project updated", result });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Delete project + delete all related applications
    app.delete("/projects/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // 1) delete project
        const projectResult = await projectsCollection.deleteOne({
          _id: new ObjectId(id)
        });

        // if project not found
        if (projectResult.deletedCount === 0) {
          return res.status(404).send({ message: "Project not found" });
        }

        // 2) delete ALL applications for this project (this is what you want)
        const appsResult = await applicationsCollection.deleteMany({ projectId: id });

        res.send({
          message: "Project and related applications deleted",
          projectDeleted: projectResult.deletedCount,
          applicationsDeleted: appsResult.deletedCount
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/completed-projects", async (req, res) => {
      try {
        const body = req.body;

        if (!body?.title) {
          return res.status(400).send({ message: "title is required" });
        }

        const doc = {
          title: body.title.trim(),
          details: body.details || {},
          createdAt: new Date(),
        };

        const result = await completedProjectsCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/completed-projects", async (req, res) => {
      try {
        const search = req.query.search?.trim();

        const query = search
          ? { title: { $regex: search, $options: "i" } }
          : {};

        const result = await completedProjectsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });





    // APPLICATION RELATED APIS

    app.post("/applications", async (req, res) => {
      try {
        const application = req.body;

        if (!application?.studentUid || !application?.projectId || !application?.supervisorUid) {
          return res.status(400).send({ message: "Missing fields" });
        }

        const projectObjectId = new ObjectId(application.projectId);

        const bookResult = await projectsCollection.updateOne(
          { _id: projectObjectId, isBooked: { $ne: true } },
          { $set: { isBooked: true, bookedBy: application.studentUid, bookedAt: new Date() } }
        );

        // If no project updated => already booked
        if (bookResult.matchedCount === 0) {
          return res.status(409).send({
            message: "This project already chosen, please apply for other project"
          });
        }

        // Optional: prevent same student duplicate app (safe)
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

      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Student: submit a proposal application (not from posted projects)
    app.post("/applications/proposal", async (req, res) => {
      try {
        const body = req.body;

        // basic validation
        if (!body?.studentUid) return res.status(400).send({ message: "studentUid is required" });
        if (!body?.supervisorUid) return res.status(400).send({ message: "supervisorUid is required" });
        if (!body?.projectTitle?.trim()) return res.status(400).send({ message: "projectTitle is required" });

        const application = {
          type: "proposal",
          status: "pending",

          studentUid: body.studentUid,
          supervisorUid: body.supervisorUid,

          projectTitle: body.projectTitle.trim(),

          // ✅ rich data goes here (like completed projects style)
          details: body.details || {},

          createdAt: new Date()
        };

        // optional: prevent duplicates (same student + same title)
        const existing = await applicationsCollection.findOne({
          type: "proposal",
          studentUid: application.studentUid,
          projectTitle: { $regex: `^${application.projectTitle}$`, $options: "i" }
        });

        if (existing) {
          return res.status(400).send({ message: "You already submitted this proposal title before." });
        }

        const result = await applicationsCollection.insertOne(application);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
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
                pipeline: [{
                  $project: {
                    userId: 1,
                    name: 1,
                    email: 1,
                    faculty: 1,
                    icPassport: 1,
                    academicYear: 1,
                    currentSemester: 1,
                    image: 1
                  }
                }],

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
                projectTitle: { $ifNull: ["$project.title", "$projectTitle"] },
                type: 1,
                proposal: 1,
                studentId: "$student.userId",
                studentName: "$student.name",
                studentEmail: "$student.email",
                studentFaculty: "$student.faculty",
                studentIcPassport: "$student.icPassport",
                studentAcademicYear: "$student.academicYear",
                studentCurrentSemester: "$student.currentSemester",
                studentImage: "$student.image",

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

    app.get("/applications/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const appDoc = await applicationsCollection.findOne({ _id: new ObjectId(id) });

        if (!appDoc) return res.status(404).send({ message: "Application not found" });

        res.send(appDoc);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    // List supervisors for dropdown
    app.get("/supervisors", async (req, res) => {
      try {
        const result = await usersCollection
          .find({ role: "supervisor" })
          .project({ firebaseUid: 1, name: 1, email: 1, userId: 1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch('/applications/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const body = req.body;

        const application = await applicationsCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!application) {
          return res.status(404).send({ message: 'Application not found' });
        }
        if (body.studentUid) {
          // Only allow owner student
          if (application.studentUid !== body.studentUid) {
            return res.status(403).send({ message: "Not allowed to edit this proposal" });
          }

          if (application.type !== "proposal") {
            return res.status(400).send({ message: "Only proposal can be edited" });
          }

          const updateDoc = {
            $set: {
              projectTitle: body.projectTitle?.trim() || application.projectTitle,
              details: body.details || application.details,
              updatedAt: new Date()
            }
          };

          const result = await applicationsCollection.updateOne(
            { _id: new ObjectId(id) },
            updateDoc
          );

          return res.send(result);
        }

        // ===============================
        // 2️⃣ SUPERVISOR ACCEPT / REJECT
        // ===============================
        const { status, reason } = body;

        if (status === "rejected" && (!reason || !reason.trim())) {
          return res.status(400).send({ message: "Rejection reason is required" });
        }

        const updateDoc = { status };

        if (status === "rejected") {
          updateDoc.rejectionReason = reason.trim();
        } else {
          updateDoc.rejectionReason = "";
        }

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateDoc }
        );

        if (status === "rejected" && application.projectId) {
          await projectsCollection.updateOne(
            { _id: new ObjectId(application.projectId) },
            { $set: { isBooked: false }, $unset: { bookedBy: "", bookedAt: "" } }
          );
        }

        await notificationsCollection.insertOne({
          userUid: application.studentUid,
          message:
            status === "rejected"
              ? `Your application was rejected. Reason: ${reason.trim()}`
              : `Your application was accepted.`,
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