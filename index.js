const express = require('express');
const cors = require('cors');
const app = express();
const multer = require('multer');
const path = require("path");
const fs = require("fs");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 8000;
require('dotenv').config();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
    const activitiesCollection = client.db("fypDB").collection("activities");
    const activityFilesCollection = client.db("fypDB").collection("activity_files");
    const activityTasksCollection = client.db("fypDB").collection("activity_tasks");
    const taskFilesCollection = client.db("fypDB").collection("task_files");
    const supervisorAssignmentsCollection = client.db("fypDB").collection("supervisor_assignments");
    const activitySectionsCollection = client.db("fypDB").collection("activity_sections");
    const sectionFilesCollection = client.db("fypDB").collection("section_files");
    const announcementsCollection = client.db("fypDB").collection("announcements");
    const studentProgressCollection = client.db("fyp_portal").collection("student_progress");


    function getViewer(req) {
      const viewerUid = req.query.viewerUid || "";
      const viewerRole = req.query.viewerRole || "";
      return { viewerUid, viewerRole };
    }
    async function getAssignedSupervisorUid(studentUid) {
      if (!studentUid) return null;
      const assign = await supervisorAssignmentsCollection.findOne(
        {
          studentUid,
          status: { $in: ["active", "assigned"] },
        },
        { projection: { supervisorUid: 1 } }
      );
      if (assign?.supervisorUid) return assign.supervisorUid;
      const app = await applicationsCollection.findOne(
        {
          studentUid,
          supervisorUid: { $exists: true, $ne: "" },
          status: { $in: ["accepted", "approved"] }, // adjust to your statuses
        },
        { projection: { supervisorUid: 1 } }
      );
      if (app?.supervisorUid) return app.supervisorUid;

      return null;
    }

    async function getActivityAndCheckAccess({ activityId, viewerUid, viewerRole }) {
      const activity = await activitiesCollection.findOne({ _id: new ObjectId(activityId) });
      if (!activity) return { ok: false, code: 404, message: "Activity not found" };

      if (viewerRole === "headSupervisor") return { ok: true, activity };

      if (viewerRole === "supervisor") {
        if (!viewerUid) return { ok: false, code: 400, message: "viewerUid required" };
        if (activity.createdBySupervisorUid !== viewerUid)
          return { ok: false, code: 403, message: "Not allowed" };
        return { ok: true, activity };
      }

      if (viewerRole === "student") {
        if (!viewerUid) return { ok: false, code: 400, message: "viewerUid required" };
        const supUid = await getAssignedSupervisorUid(viewerUid);
        if (!supUid) return { ok: false, code: 403, message: "No assigned supervisor" };
        if (activity.createdBySupervisorUid !== supUid)
          return { ok: false, code: 403, message: "Not allowed" };
        return { ok: true, activity };
      }

      return { ok: false, code: 403, message: "Not allowed" };
    }

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        if (!user?.firebaseUid || !user?.email) {
          return res.status(400).send({ message: "firebaseUid and email are required" });
        }

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

    app.get("/students", async (req, res) => {
      try {
        const { studentId } = req.query;

        const filter = { role: "student" };
        if (studentId && studentId.trim()) {
          filter.userId = studentId.trim(); // exact match
        }

        const students = await usersCollection
          .find(filter) // ✅ returns all fields
          .sort({ createdAt: -1 })
          .toArray();

        res.send(students);
      } catch (err) {
        console.log(err);
        res.status(500).send({ message: "Failed to fetch students" });
      }
    });

    // ✅ Head Supervisor: Full student profile + related info
    app.get("/students/:firebaseUid/full", async (req, res) => {
      try {
        const firebaseUid = req.params.firebaseUid;

        // 1) student full doc
        const student = await usersCollection.findOne({ firebaseUid });
        if (!student) return res.status(404).send({ message: "Student not found" });

        // 2) student's applications (adjust field name if yours differs)
        // Common fields: studentUid / firebaseUid / applicantUid
        const applications = await applicationsCollection
          .find({
            $or: [
              { studentUid: firebaseUid },
              { firebaseUid: firebaseUid },
              { applicantUid: firebaseUid },
              { studentId: student.userId }, // fallback
            ],
          })
          .sort({ createdAt: -1 })
          .toArray();

        // 3) supervisor assignment (best-effort)
        // We'll infer from an "approved/accepted" application
        const approved =
          applications.find((a) =>
            String(a.status || "").toLowerCase().includes("accept") ||
            String(a.status || "").toLowerCase().includes("approve")
          ) || null;

        let supervisor = null;

        // If application directly stores supervisor uid
        const supervisorUid =
          approved?.supervisorUid || approved?.supervisorFirebaseUid || approved?.supervisorId || null;

        if (supervisorUid) {
          supervisor = await usersCollection.findOne({ firebaseUid: supervisorUid });
        }

        // 4) submission/task history (based on your existing Activity files pattern)
        // Your backend earlier used activityFilesCollection and uploaderUid.
        const submissions = await activityFilesCollection
          .find({
            type: "student",
            uploaderUid: firebaseUid,
          })
          .sort({ uploadedAt: -1 })
          .toArray();

        // (Optional) enrich submissions with activity info if you have activitiesCollection
        // If you have activitiesCollection defined, uncomment below:
        /*
        const activityIds = [...new Set(submissions.map(s => s.activityId).filter(Boolean))];
        const activities = await activitiesCollection.find({ id: { $in: activityIds } }).toArray();
        const activityMap = new Map(activities.map(a => [String(a.id), a]));
    
        const submissionsEnriched = submissions.map(s => ({
          ...s,
          activity: activityMap.get(String(s.activityId)) || null,
        }));
        */

        res.send({
          student,              // ✅ all fields from users collection
          applications,
          supervisor,           // may be null if not assigned yet
          submissions,          // student upload history
        });
      } catch (err) {
        console.log(err);
        res.status(500).send({ message: "Failed to load student full details" });
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

    // Supervisor creates a task for a project
    app.post("/projects/:projectId/tasks", async (req, res) => {
      try {
        const { projectId } = req.params;
        const body = req.body;

        if (!body?.title?.trim()) return res.status(400).send({ message: "title required" });
        if (!body?.supervisorUid) return res.status(400).send({ message: "supervisorUid required" });

        // 1) make sure project exists and belongs to this supervisor
        const project = await projectsCollection.findOne({ _id: new ObjectId(projectId) });
        if (!project) return res.status(404).send({ message: "Project not found" });

        if (project.supervisorUid !== body.supervisorUid) {
          return res.status(403).send({ message: "Not allowed (not your project)" });
        }

        const doc = {
          projectId,
          supervisorUid: body.supervisorUid,
          title: body.title.trim(),
          instructions: body.instructions?.trim() || "",
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          totalPoints: Number(body.totalPoints || 0),
          allowSubmissions: body.allowSubmissions !== false,
          createdAt: new Date()
        };

        const result = await activityTasksCollection.insertOne(doc);
        res.send(result);
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.get("/projects/:projectId/tasks", async (req, res) => {
      try {
        const { projectId } = req.params;

        const tasks = await activityTasksCollection
          .find({ projectId })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(tasks);
      } catch (e) {
        res.status(500).send({ error: e.message });
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
        const form = application.applicationForm || {};
        const requiredFields = ["motivation", "canCompleteOnTime", "canFinishProject", "plan"];
        const missing = requiredFields.filter((k) => !form[k] || !String(form[k]).trim());

        if (missing.length) {
          return res.status(400).send({
            message: `Please fill all application questions: ${missing.join(", ")}`
          });
        }
        const activeAssign = await supervisorAssignmentsCollection.findOne({
          studentUid: application.studentUid,
          status: "active"
        });

        if (!activeAssign) {
          return res.status(400).send({ message: "No supervisor assigned to this student." });
        }
        if (activeAssign.supervisorUid !== application.supervisorUid) {
          return res.status(400).send({ message: "You can only apply to your assigned supervisor's projects." });
        }

        const projectObjectId = new ObjectId(application.projectId);
        const project = await projectsCollection.findOne({ _id: projectObjectId });
        if (!project) {
          return res.status(404).send({ message: "Project not found" });
        }

        if (project.supervisorUid !== activeAssign.supervisorUid) {
          return res.status(400).send({ message: "You can only apply to projects posted by your assigned supervisor." });
        }

        const existing = await applicationsCollection.findOne({
          studentUid: application.studentUid,
          projectId: application.projectId
        });
        if (existing) {
          return res.status(409).send({ message: "You already applied for this project." });
        }

        const bookResult = await projectsCollection.updateOne(
          { _id: projectObjectId, isBooked: { $ne: true } },
          { $set: { isBooked: true, bookedBy: application.studentUid, bookedAt: new Date() } }
        );

        if (bookResult.matchedCount === 0) {
          return res.status(409).send({
            message: "This project already chosen, please apply for other project"
          });
        }

        const doc = {
          ...application,
          type: "application",
          applicationForm: {
            motivation: String(form.motivation).trim(),
            canCompleteOnTime: String(form.canCompleteOnTime).trim(),
            canFinishProject: String(form.canFinishProject).trim(),
            plan: String(form.plan).trim()
          },
          status: "pending",
          createdAt: new Date()
        };

        const result = await applicationsCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/applications/proposal", async (req, res) => {
      try {
        const body = req.body;

        // basic validation
        if (!body?.studentUid) return res.status(400).send({ message: "studentUid is required" });
        if (!body?.supervisorUid) return res.status(400).send({ message: "supervisorUid is required" });
        if (!body?.projectTitle?.trim()) return res.status(400).send({ message: "projectTitle is required" });


        const activeAssign = await supervisorAssignmentsCollection.findOne({
          studentUid: body.studentUid,
          status: "active"
        });

        if (!activeAssign) {
          return res.status(400).send({ message: "No supervisor assigned to this student." });
        }


        if (activeAssign.supervisorUid !== body.supervisorUid) {
          return res.status(400).send({ message: "You can only submit to your assigned supervisor." });
        }

        const application = {
          type: "proposal",
          status: "pending",
          studentUid: body.studentUid,
          supervisorUid: body.supervisorUid,
          projectTitle: body.projectTitle.trim(),
          details: body.details || {},
          createdAt: new Date()
        };
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
                details: 1,
                applicationForm: 1,
                studentId: "$student.userId",
                studentName: "$student.name",
                studentEmail: "$student.email",
                studentFaculty: "$student.faculty",
                studentIcPassport: "$student.icPassport",
                studentAcademicYear: "$student.academicYear",
                studentCurrentSemester: "$student.currentSemester",
                studentImage: "$student.image"
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



    // Student Progress related APIs


    const DEFAULT_IP1_ITEMS = [
      "Project Title",
      "Background",
      "Problem Statement",
      "Aims",
      "Objectives",
      "Justification",
      "Scope",
      "Approach and Deliverables",
      "Major Milestone with Gantt chart",
      "Constraints and Assumptions",
      "Resources",
      "External Bodies Involved",
      "Project Plan",
      "References (At least 3 related journals papers printed and attached)"
    ];

    const DEFAULT_IP2_ITEMS = [
      "UI/UX design done",
      "Backend logic and Database setup finished",
      "Backend APIs working properly",
      "Frontend connection with backend done",
      "Report writing Started",
      "Report writing done"
    ];

    const makeChecklist = (items) => {
      return items.map((label) => ({
        label,
        done: false,
        updatedAt: null
      }));
    };

    app.get("/application-progress/:appId", async (req, res) => {
      try {
        const { appId } = req.params;

        const application = await applicationsCollection.findOne({
          _id: new ObjectId(appId),
        });

        if (!application) {
          return res.status(404).send({ message: "Application not found" });
        }

        const existing = await studentProgressCollection.findOne({
          applicationId: appId,
        });

        if (existing) {
          return res.send(existing);
        }

        const newDoc = {
          applicationId: appId,
          studentUid: application.studentUid || "",
          supervisorUid: application.supervisorUid || "",
          projectTitle: application.projectTitle || "Untitled Project",
          type: application.type || "normal",
          ip1: makeChecklist(DEFAULT_IP1_ITEMS),
          ip2: makeChecklist(DEFAULT_IP2_ITEMS),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await studentProgressCollection.insertOne(newDoc);
        const inserted = await studentProgressCollection.findOne({
          _id: result.insertedId,
        });

        res.send(inserted);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Failed to load application progress" });
      }
    });

    app.patch("/application-progress/:appId", async (req, res) => {
      try {
        const { appId } = req.params;
        const { ip1, ip2 } = req.body;

        const application = await applicationsCollection.findOne({
          _id: new ObjectId(appId),
        });

        if (!application) {
          return res.status(404).send({ message: "Application not found" });
        }

        const accepted = ["accepted", "approved"].includes(application.status);
        if (!accepted) {
          return res.status(403).send({
            message: "Only accepted applications can update progress",
          });
        }

        const existing = await studentProgressCollection.findOne({
          applicationId: appId,
        });

        if (!existing) {
          const newDoc = {
            applicationId: appId,
            studentUid: application.studentUid || "",
            supervisorUid: application.supervisorUid || "",
            projectTitle: application.projectTitle || "Untitled Project",
            type: application.type || "normal",
            ip1: Array.isArray(ip1) ? ip1 : makeChecklist(DEFAULT_IP1_ITEMS),
            ip2: Array.isArray(ip2) ? ip2 : makeChecklist(DEFAULT_IP2_ITEMS),
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await studentProgressCollection.insertOne(newDoc);
          return res.send({ message: "Progress created successfully" });
        }

        const updateDoc = {
          projectTitle: application.projectTitle || existing.projectTitle || "Untitled Project",
          supervisorUid: application.supervisorUid || existing.supervisorUid || "",
          studentUid: application.studentUid || existing.studentUid || "",
          type: application.type || existing.type || "normal",
          updatedAt: new Date(),
        };

        if (Array.isArray(ip1)) updateDoc.ip1 = ip1;
        if (Array.isArray(ip2)) updateDoc.ip2 = ip2;

        await studentProgressCollection.updateOne(
          { applicationId: appId },
          { $set: updateDoc }
        );

        res.send({ message: "Progress updated successfully" });
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Failed to update application progress" });
      }
    });

    app.get("/supervisors/:uid/student-progress", async (req, res) => {
      try {
        const supervisorUid = req.params.uid;

        const apps = await applicationsCollection
          .find({
            supervisorUid,
            status: { $in: ["accepted", "approved"] },
          })
          .sort({ createdAt: -1 })
          .toArray();

        if (!apps.length) {
          return res.send([]);
        }

        const studentUids = [...new Set(apps.map((a) => a.studentUid).filter(Boolean))];
        const appIds = apps.map((a) => String(a._id));

        const students = await usersCollection
          .find(
            { firebaseUid: { $in: studentUids } },
            { projection: { firebaseUid: 1, userId: 1, name: 1, email: 1 } }
          )
          .toArray();

        const progressDocs = await studentProgressCollection
          .find({ applicationId: { $in: appIds } })
          .toArray();

        const studentMap = Object.fromEntries(
          students.map((s) => [s.firebaseUid, s])
        );

        const progressMap = Object.fromEntries(
          progressDocs.map((p) => [p.applicationId, p])
        );

        const result = apps.map((app) => {
          const appId = String(app._id);

          return {
            applicationId: appId,
            application: {
              _id: appId,
              projectTitle: app.projectTitle || "Untitled Project",
              type: app.type || "normal",
              status: app.status || "pending",
            },
            studentUid: app.studentUid || "",
            student: studentMap[app.studentUid] || null,
            progress: progressMap[appId] || {
              applicationId: appId,
              studentUid: app.studentUid || "",
              supervisorUid: app.supervisorUid || "",
              projectTitle: app.projectTitle || "Untitled Project",
              type: app.type || "normal",
              ip1: makeChecklist(DEFAULT_IP1_ITEMS),
              ip2: makeChecklist(DEFAULT_IP2_ITEMS),
              createdAt: null,
              updatedAt: null,
            },
          };
        });

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Failed to load supervisor student progress" });
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

    // Get all students
    app.get("/students", async (req, res) => {
      try {
        const { studentId } = req.query;

        const filter = { role: "student" };

        if (studentId && studentId.trim()) {
          filter.userId = studentId.trim(); // exact match
        }
        const students = await usersCollection
          .find(filter) // ✅ all fields
          .sort({ createdAt: -1 })
          .toArray();

        res.send(students);
      } catch (err) {
        console.log(err);
        res.status(500).send({ message: "Failed to fetch students" });
      }
    });

    // ✅ Head Supervisor: full student details + applications + supervisor + submissions/tasks
    app.get("/students/:studentUid/full", async (req, res) => {
      try {
        const studentUid = req.params.studentUid;

        // 1) full student document
        const student = await usersCollection.findOne({ firebaseUid: studentUid });
        if (!student) return res.status(404).send({ message: "Student not found" });

        // 2) all applications of this student
        const applications = await applicationsCollection
          .find({ studentUid })
          .sort({ createdAt: -1 })
          .toArray();

        // 3) current supervisor assignment
        // We define "current supervisor" = most recent application with status "approved" (or "accepted" if you use that)
        const assignedApp =
          applications.find((a) => a.status === "approved" || a.status === "accepted") || null;

        let supervisor = null;
        if (assignedApp?.supervisorUid) {
          supervisor = await usersCollection.findOne({ firebaseUid: assignedApp.supervisorUid });
        }

        // 4) student submissions history (uploads)
        const submissions = await activityFilesCollection
          .find({ type: "student", uploaderUid: studentUid })
          .sort({ uploadedAt: -1 })
          .toArray();

        // 5) attach activity info (task title + creator)
        const activityIds = [...new Set(submissions.map((s) => s.activityId).filter(Boolean))];

        const activities = activityIds.length
          ? await activitiesCollection
            .find({ _id: { $in: activityIds.map((id) => new ObjectId(id)) } })
            .toArray()
          : [];

        const activityMap = new Map(activities.map((a) => [String(a._id), a]));

        const submissionsWithActivity = submissions.map((s) => {
          const act = activityMap.get(String(s.activityId));
          return {
            ...s,
            activityTitle: act?.title || "",
            activityCreatedBySupervisorUid: act?.createdBySupervisorUid || "",
            activityCreatedAt: act?.createdAt || null,
          };
        });

        res.send({
          student,
          applications,
          supervisor,
          submissions: submissionsWithActivity,
        });
      } catch (err) {
        console.log(err);
        res.status(500).send({ message: "Failed to load student full details" });
      }
    });

    // Supervisor: get my students (with student info)
    app.get("/supervisors/:uid/students", async (req, res) => {
      try {
        const supervisorUid = req.params.uid;

        // 1) all active assignments for this supervisor
        const assigns = await supervisorAssignmentsCollection
          .find({ supervisorUid, status: "active" })
          .toArray();

        const studentUids = assigns.map(a => a.studentUid);

        if (studentUids.length === 0) return res.send([]);

        // 2) fetch student user docs
        const students = await usersCollection
          .find(
            { firebaseUid: { $in: studentUids } },
            { projection: { firebaseUid: 1, userId: 1, name: 1, email: 1, role: 1 } }
          )
          .toArray();

        // 3) return students (optionally include assignedAt)
        const assignedAtMap = Object.fromEntries(assigns.map(a => [a.studentUid, a.assignedAt]));
        const result = students.map(s => ({
          ...s,
          assignedAt: assignedAtMap[s.firebaseUid] || null
        }));

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Student: get my supervisor (with supervisor info)
    app.get("/students/:uid/supervisor", async (req, res) => {
      try {
        const studentUid = req.params.uid;

        // 1) find active assignment
        const assignment = await supervisorAssignmentsCollection.findOne({
          studentUid,
          status: "active"
        });

        if (!assignment) return res.send(null);

        // 2) find supervisor user doc
        const supervisor = await usersCollection.findOne(
          { firebaseUid: assignment.supervisorUid },
          { projection: { firebaseUid: 1, userId: 1, name: 1, email: 1, role: 1 } }
        );

        res.send({
          assignment,
          supervisor: supervisor || null
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Head supervisor: list all active assignments with student + supervisor info
    app.get("/assignments/all", async (req, res) => {
      try {
        const assigns = await supervisorAssignmentsCollection
          .find({ status: "active" })
          .sort({ assignedAt: -1 })
          .toArray();

        if (assigns.length === 0) return res.send([]);

        const studentUids = assigns.map(a => a.studentUid);
        const supervisorUids = assigns.map(a => a.supervisorUid);

        const users = await usersCollection
          .find(
            { firebaseUid: { $in: [...new Set([...studentUids, ...supervisorUids])] } },
            { projection: { firebaseUid: 1, userId: 1, name: 1, email: 1, role: 1 } }
          )
          .toArray();

        const byUid = Object.fromEntries(users.map(u => [u.firebaseUid, u]));

        const result = assigns.map(a => ({
          _id: a._id,
          studentUid: a.studentUid,
          supervisorUid: a.supervisorUid,
          assignedAt: a.assignedAt,
          assignedByUid: a.assignedByUid,
          student: byUid[a.studentUid] || null,
          supervisor: byUid[a.supervisorUid] || null
        }));

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


    // ACTIVITIES RELATED API


    app.post("/activities", async (req, res) => {
      try {
        const body = req.body;

        if (!body?.title?.trim()) {
          return res.status(400).send({ message: "title is required" });
        }

        const doc = {
          title: body.title.trim(),
          description: body.description?.trim() || "",
          createdBySupervisorUid: body.createdBySupervisorUid || "",
          createdAt: new Date()
        };

        const result = await activitiesCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/activities", async (req, res) => {
      try {
        const { viewerUid, viewerRole } = getViewer(req);

        // Head Supervisor: see all
        if (viewerRole === "headSupervisor") {
          const items = await activitiesCollection.find({}).sort({ createdAt: -1 }).toArray();
          return res.send(items);
        }

        // Supervisor: see only own
        if (viewerRole === "supervisor") {
          if (!viewerUid) return res.status(400).send({ message: "viewerUid required" });
          const items = await activitiesCollection
            .find({ createdBySupervisorUid: viewerUid })
            .sort({ createdAt: -1 })
            .toArray();
          return res.send(items);
        }

        // Student: see only assigned supervisor activities
        if (viewerRole === "student") {
          if (!viewerUid) return res.status(400).send({ message: "viewerUid required" });

          const supUid = await getAssignedSupervisorUid(viewerUid);
          if (!supUid) return res.send([]); // not assigned yet => show nothing

          const items = await activitiesCollection
            .find({ createdBySupervisorUid: supUid })
            .sort({ createdAt: -1 })
            .toArray();

          return res.send(items);
        }

        return res.status(403).send({ message: "Not allowed" });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    app.post("/activities/:id/upload", upload.single("file"), async (req, res) => {
      try {
        const activityId = req.params.id;
        const uploaderUid = req.body.uploaderUid || "";

        if (!req.file) return res.status(400).send({ message: "file is required" });

        const doc = {
          activityId,
          type: "supervisor",
          uploaderUid,
          fileName: req.file.originalname,
          storedName: req.file.filename,
          fileUrl: `/uploads/${req.file.filename}`,
          uploadedAt: new Date()
        };

        const result = await activityFilesCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    app.post("/activities/:id/submit", upload.single("file"), async (req, res) => {
      return res.status(403).send({
        message: "Submission is not allowed here. Submit inside a Task."
      });
    });


    app.get("/activities/:id/files", async (req, res) => {
      try {
        const activityId = req.params.id;
        const { viewerUid, viewerRole } = getViewer(req);

        const access = await getActivityAndCheckAccess({ activityId, viewerUid, viewerRole });
        if (!access.ok) return res.status(access.code).send({ message: access.message });

        const items = await activityFilesCollection
          .find({ activityId })
          .sort({ uploadedAt: -1 })
          .toArray();

        for (const f of items) {
          if (f.type === "student" && f.uploaderUid) {
            const student = await usersCollection.findOne(
              { firebaseUid: f.uploaderUid },
              { projection: { userId: 1, name: 1, email: 1 } }
            );
            f.studentUserId = student?.userId || "";
            f.studentName = student?.name || "";
            f.studentEmail = student?.email || "";
          }
        }

        res.send(items);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/sections/:sectionId/tasks", async (req, res) => {
      try {
        const { sectionId } = req.params;
        const body = req.body;

        if (!body?.title?.trim()) {
          return res.status(400).send({ message: "title required" });
        }

        const section = await activitySectionsCollection.findOne({
          _id: new ObjectId(sectionId)
        });

        if (!section) {
          return res.status(404).send({ message: "Section not found" });
        }

        if (section.type !== "submission") {
          return res.status(400).send({ message: "Tasks can only be created in submission subsection" });
        }

        const activity = await activitiesCollection.findOne({
          _id: new ObjectId(section.activityId)
        });

        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }

        if (activity.createdBySupervisorUid !== body.createdBySupervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        const doc = {
          activityId: section.activityId,
          sectionId,
          title: body.title.trim(),
          instructions: body.instructions?.trim() || "",
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          totalPoints: Number(body.totalPoints || 0),
          allowSubmissions: body.allowSubmissions !== false,
          createdBySupervisorUid: body.createdBySupervisorUid || "",
          createdAt: new Date()
        };

        const result = await activityTasksCollection.insertOne(doc);
        res.send(result);
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    // Supervisor: OPEN / CLOSE task submission
    app.patch("/tasks/:taskId/submission", async (req, res) => {
      try {
        const taskId = req.params.taskId;
        const { supervisorUid, allowSubmissions } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid is required" });
        }

        const task = await activityTasksCollection.findOne({
          _id: new ObjectId(taskId)
        });

        if (!task) {
          return res.status(404).send({ message: "Task not found" });
        }

        // Only creator supervisor can open/close
        if (task.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        const result = await activityTasksCollection.updateOne(
          { _id: new ObjectId(taskId) },
          {
            $set: {
              allowSubmissions: !!allowSubmissions,
              updatedAt: new Date()
            }
          }
        );

        res.send({ message: "Submission status updated", result });

      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/sections/:sectionId/tasks", async (req, res) => {
      try {
        const { sectionId } = req.params;
        const { viewerUid, viewerRole } = getViewer(req);

        const section = await activitySectionsCollection.findOne({
          _id: new ObjectId(sectionId)
        });

        if (!section) {
          return res.status(404).send({ message: "Section not found" });
        }

        const access = await getActivityAndCheckAccess({
          activityId: section.activityId,
          viewerUid,
          viewerRole
        });

        if (!access.ok) {
          return res.status(access.code).send({ message: access.message });
        }

        const tasks = await activityTasksCollection
          .find({ sectionId })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(tasks);
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.post("/tasks/:taskId/upload", upload.single("file"), async (req, res) => {
      try {
        const taskId = req.params.taskId;
        if (!req.file) return res.status(400).send({ message: "file required" });

        const doc = {
          taskId,
          type: "supervisor",
          uploaderUid: req.body.uploaderUid || "",
          fileName: req.file.originalname,
          storedName: req.file.filename,
          fileUrl: `/uploads/${req.file.filename}`,
          uploadedAt: new Date()
        };

        const result = await taskFilesCollection.insertOne(doc);
        res.send(result);
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.post("/tasks/:taskId/submit", upload.single("file"), async (req, res) => {
      try {
        const taskId = req.params.taskId;
        const studentUid = req.body.studentUid;

        if (!studentUid) {
          return res.status(400).send({ message: "studentUid required" });
        }

        if (!req.file) {
          return res.status(400).send({ message: "file required" });
        }

        const task = await activityTasksCollection.findOne({
          _id: new ObjectId(taskId)
        });

        if (!task) {
          return res.status(404).send({ message: "Task not found" });
        }

        const supUid = await getAssignedSupervisorUid(studentUid);
        if (!supUid) {
          return res.status(403).send({ message: "No assigned supervisor" });
        }

        const activity = await activitiesCollection.findOne({
          _id: new ObjectId(task.activityId)
        });

        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }

        if (activity.createdBySupervisorUid !== supUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        if (task.allowSubmissions === false) {
          return res.status(403).send({
            message: "Submission is closed for this task"
          });
        }

        // ✅ Allow multiple submissions
        const previousCount = await taskFilesCollection.countDocuments({
          taskId,
          uploaderUid: studentUid,
          type: "student"
        });

        const doc = {
          taskId,
          activityId: task.activityId,
          sectionId: task.sectionId || null,
          type: "student",
          uploaderUid: studentUid,
          attemptNumber: previousCount + 1,
          fileName: req.file.originalname,
          storedName: req.file.filename,
          fileUrl: `/uploads/${req.file.filename}`,
          uploadedAt: new Date()
        };

        const result = await taskFilesCollection.insertOne(doc);

        res.send({
          message: "Submission uploaded successfully",
          insertedId: result.insertedId,
          attemptNumber: doc.attemptNumber
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Update activity title (supervisor)
    app.patch("/activities/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { title, supervisorUid } = req.body;

        if (!supervisorUid) return res.status(400).send({ message: "supervisorUid required" });
        if (!title || !title.trim()) return res.status(400).send({ message: "title required" });

        const activity = await activitiesCollection.findOne({ _id: new ObjectId(id) });
        if (!activity) return res.status(404).send({ message: "Activity not found" });

        // Only creator supervisor can edit (same rule as your tasks)
        if (activity.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        const result = await activitiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { title: title.trim(), updatedAt: new Date() } }
        );

        res.send({ message: "Activity updated", result });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    // Delete activity + related tasks/files (supervisor)
    app.delete("/activities/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { supervisorUid } = req.body;
        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }
        const activity = await activitiesCollection.findOne({ _id: new ObjectId(id) });
        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }
        if (activity.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }
        const tasks = await activityTasksCollection.find({ activityId: id }).toArray();
        const taskIds = tasks.map((t) => String(t._id));
        if (taskIds.length > 0) {
          await taskFilesCollection.deleteMany({ taskId: { $in: taskIds } });
        }
        await activityTasksCollection.deleteMany({ activityId: id });
        await activityFilesCollection.deleteMany({ activityId: id });
        await sectionFilesCollection.deleteMany({ activityId: id });
        await activitySectionsCollection.deleteMany({ activityId: id });
        const result = await activitiesCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ message: "Activity deleted", result });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });


    app.delete("/activities/files/:fileId", async (req, res) => {
      try {
        const { fileId } = req.params;
        const { supervisorUid } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }
        // 1) find file record
        const fileDoc = await activityFilesCollection.findOne({ _id: new ObjectId(fileId) });
        if (!fileDoc) return res.status(404).send({ message: "File not found" });
        // only supervisor files can be deleted here (optional but safer)
        if (fileDoc.type !== "supervisor") {
          return res.status(403).send({ message: "Not allowed" });
        }
        // 2) find the activity to verify owner supervisor
        const activity = await activitiesCollection.findOne({ _id: new ObjectId(fileDoc.activityId) });
        if (!activity) return res.status(404).send({ message: "Activity not found" });
        if (activity.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }
        if (fileDoc.fileUrl) {
          const relativePath = fileDoc.fileUrl.startsWith("/")
            ? fileDoc.fileUrl.slice(1)
            : fileDoc.fileUrl;
          const fullPath = path.join(__dirname, relativePath);
          fs.unlink(fullPath, (err) => {
            // ignore file missing error, still delete DB record
          });
        }
        // 4) delete DB record
        const result = await activityFilesCollection.deleteOne({ _id: new ObjectId(fileId) });
        res.send({ message: "File deleted", result });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.get("/tasks/:taskId/files", async (req, res) => {
      try {
        const taskId = req.params.taskId;
        const { viewerUid, viewerRole } = getViewer(req);

        const task = await activityTasksCollection.findOne({ _id: new ObjectId(taskId) });
        if (!task) return res.status(404).send({ message: "Task not found" });

        // Check access using the task's activityId
        const access = await getActivityAndCheckAccess({
          activityId: task.activityId,
          viewerUid,
          viewerRole
        });
        if (!access.ok) return res.status(access.code).send({ message: access.message });

        const items = await taskFilesCollection.find({ taskId }).sort({ uploadedAt: -1 }).toArray();
        for (const f of items) {
          if (f.type === "student" && f.uploaderUid) {
            const student = await usersCollection.findOne(
              { firebaseUid: f.uploaderUid },
              { projection: { userId: 1, name: 1, email: 1 } }
            );

            f.studentUserId = student?.userId || "";
            f.studentName = student?.name || "";
            f.studentEmail = student?.email || "";
          }
        }
        res.send(items);
      } catch (e) {
        res.status(500).send({ error: e.message });
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
        const existing = await logbooksCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).send({ message: 'Logbook not found' });
        if (existing.reviewed) return res.status(400).send({ message: 'Cannot edit logbook after review' });
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
        const logbook = await logbooksCollection.findOne({ _id: new ObjectId(id) });
        if (!logbook) return res.status(404).send({ message: 'Logbook not found' });
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

    // Head supervisor assigns supervisor to student
    app.put("/assignments", async (req, res) => {
      try {
        const { studentUid, supervisorUid, assignedByUid } = req.body;
        if (!studentUid || !supervisorUid || !assignedByUid) {
          return res.status(400).send({ message: "studentUid, supervisorUid, assignedByUid are required" });
        }
        const result = await supervisorAssignmentsCollection.updateOne(
          { studentUid },
          {
            $set: {
              studentUid,
              supervisorUid,
              assignedByUid,
              status: "active",
              assignedAt: new Date()
            }
          },
          { upsert: true }
        );
        res.send({ message: "Assigned successfully", result });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get assignments (for supervisor OR student)
    app.get("/assignments", async (req, res) => {
      try {
        const { supervisorUid, studentUid } = req.query;
        if (!supervisorUid && !studentUid) {
          return res.status(400).send({ message: "supervisorUid or studentUid is required" });
        }
        const query = { status: "active", ...(supervisorUid ? { supervisorUid } : {}), ...(studentUid ? { studentUid } : {}) };
        const items = await supervisorAssignmentsCollection.find(query).sort({ assignedAt: -1 }).toArray();
        res.send(items);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    app.post("/activities/:activityId/sections", async (req, res) => {
      try {
        const { activityId } = req.params;
        const {
          title,
          parentSectionId = null,
          type = "group",
          order = 0,
          supervisorUid
        } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }

        if (!title?.trim()) {
          return res.status(400).send({ message: "title required" });
        }

        if (!["group", "materials", "submission"].includes(type)) {
          return res.status(400).send({ message: "Invalid section type" });
        }

        const activity = await activitiesCollection.findOne({ _id: new ObjectId(activityId) });
        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }

        if (activity.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        if (parentSectionId) {
          const parent = await activitySectionsCollection.findOne({
            _id: new ObjectId(parentSectionId)
          });

          if (!parent) {
            return res.status(404).send({ message: "Parent section not found" });
          }

          if (parent.activityId !== activityId) {
            return res.status(400).send({ message: "Parent section does not belong to this activity" });
          }
        }

        const doc = {
          activityId,
          parentSectionId: parentSectionId || null,
          title: title.trim(),
          type,
          order: Number(order || 0),
          createdBySupervisorUid: supervisorUid,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await activitySectionsCollection.insertOne(doc);
        res.send(result);
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.get("/activities/:activityId/sections", async (req, res) => {
      try {
        const { activityId } = req.params;
        const { viewerUid, viewerRole } = getViewer(req);

        const access = await getActivityAndCheckAccess({ activityId, viewerUid, viewerRole });
        if (!access.ok) {
          return res.status(access.code).send({ message: access.message });
        }

        const items = await activitySectionsCollection
          .find({ activityId })
          .sort({ order: 1, createdAt: 1 })
          .toArray();

        res.send(items);
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.patch("/sections/:sectionId", async (req, res) => {
      try {
        const { sectionId } = req.params;
        const { title, type, order, supervisorUid } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }

        const section = await activitySectionsCollection.findOne({
          _id: new ObjectId(sectionId)
        });

        if (!section) {
          return res.status(404).send({ message: "Section not found" });
        }

        const activity = await activitiesCollection.findOne({
          _id: new ObjectId(section.activityId)
        });

        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }

        if (activity.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        const updateDoc = {
          updatedAt: new Date()
        };

        if (title !== undefined) {
          if (!title.trim()) return res.status(400).send({ message: "title required" });
          updateDoc.title = title.trim();
        }

        if (type !== undefined) {
          if (!["group", "materials", "submission"].includes(type)) {
            return res.status(400).send({ message: "Invalid section type" });
          }
          updateDoc.type = type;
        }

        if (order !== undefined) {
          updateDoc.order = Number(order || 0);
        }

        const result = await activitySectionsCollection.updateOne(
          { _id: new ObjectId(sectionId) },
          { $set: updateDoc }
        );

        res.send({ message: "Section updated", result });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.delete("/sections/:sectionId", async (req, res) => {
      try {
        const { sectionId } = req.params;
        const { supervisorUid } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }

        const rootSection = await activitySectionsCollection.findOne({
          _id: new ObjectId(sectionId)
        });

        if (!rootSection) {
          return res.status(404).send({ message: "Section not found" });
        }

        const activity = await activitiesCollection.findOne({
          _id: new ObjectId(rootSection.activityId)
        });

        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }

        if (activity.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        const allSections = await activitySectionsCollection.find({
          activityId: rootSection.activityId
        }).toArray();

        const collectIds = (parentId) => {
          let ids = [parentId];
          for (const s of allSections) {
            if (s.parentSectionId === parentId) {
              ids = ids.concat(collectIds(String(s._id)));
            }
          }
          return ids;
        };

        const sectionIds = collectIds(sectionId);

        await sectionFilesCollection.deleteMany({ sectionId: { $in: sectionIds } });

        const tasks = await activityTasksCollection.find({
          sectionId: { $in: sectionIds }
        }).toArray();

        const taskIds = tasks.map((t) => String(t._id));

        if (taskIds.length > 0) {
          await taskFilesCollection.deleteMany({ taskId: { $in: taskIds } });
          await activityTasksCollection.deleteMany({ sectionId: { $in: sectionIds } });
        }

        await activitySectionsCollection.deleteMany({
          _id: { $in: sectionIds.map((id) => new ObjectId(id)) }
        });

        res.send({ message: "Section deleted" });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });

    app.post("/sections/:sectionId/upload", upload.single("file"), async (req, res) => {
      try {
        const { sectionId } = req.params;
        const uploaderUid = req.body.uploaderUid || "";

        if (!req.file) {
          return res.status(400).send({ message: "file is required" });
        }

        const section = await activitySectionsCollection.findOne({
          _id: new ObjectId(sectionId)
        });

        if (!section) {
          return res.status(404).send({ message: "Section not found" });
        }

        if (section.type !== "materials") {
          return res.status(400).send({ message: "Upload allowed only in materials subsection" });
        }

        const activity = await activitiesCollection.findOne({
          _id: new ObjectId(section.activityId)
        });

        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }

        if (activity.createdBySupervisorUid !== uploaderUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        const doc = {
          sectionId,
          activityId: section.activityId,
          type: "supervisor",
          uploaderUid,
          fileName: req.file.originalname,
          storedName: req.file.filename,
          fileUrl: `/uploads/${req.file.filename}`,
          uploadedAt: new Date()
        };

        const result = await sectionFilesCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/sections/:sectionId/files", async (req, res) => {
      try {
        const { sectionId } = req.params;
        const { viewerUid, viewerRole } = getViewer(req);

        const section = await activitySectionsCollection.findOne({
          _id: new ObjectId(sectionId)
        });

        if (!section) {
          return res.status(404).send({ message: "Section not found" });
        }

        const access = await getActivityAndCheckAccess({
          activityId: section.activityId,
          viewerUid,
          viewerRole
        });

        if (!access.ok) {
          return res.status(access.code).send({ message: access.message });
        }

        const items = await sectionFilesCollection
          .find({ sectionId })
          .sort({ uploadedAt: -1 })
          .toArray();

        res.send(items);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.delete("/sections/files/:fileId", async (req, res) => {
      try {
        const { fileId } = req.params;
        const { supervisorUid } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }

        const fileDoc = await sectionFilesCollection.findOne({ _id: new ObjectId(fileId) });
        if (!fileDoc) {
          return res.status(404).send({ message: "File not found" });
        }

        const section = await activitySectionsCollection.findOne({
          _id: new ObjectId(fileDoc.sectionId)
        });
        if (!section) {
          return res.status(404).send({ message: "Section not found" });
        }

        const activity = await activitiesCollection.findOne({
          _id: new ObjectId(section.activityId)
        });
        if (!activity) {
          return res.status(404).send({ message: "Activity not found" });
        }

        if (activity.createdBySupervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        if (fileDoc.fileUrl) {
          const relativePath = fileDoc.fileUrl.startsWith("/")
            ? fileDoc.fileUrl.slice(1)
            : fileDoc.fileUrl;
          const fullPath = path.join(__dirname, relativePath);
          fs.unlink(fullPath, () => { });
        }

        const result = await sectionFilesCollection.deleteOne({
          _id: new ObjectId(fileId)
        });

        res.send({ message: "File deleted", result });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });


    // ANNOUNCEMENTS RELATED APIS

    app.post("/announcements", async (req, res) => {
      try {
        const { title, message, supervisorUid } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }

        if (!title?.trim()) {
          return res.status(400).send({ message: "title required" });
        }

        if (!message?.trim()) {
          return res.status(400).send({ message: "message required" });
        }

        const supervisor = await usersCollection.findOne({ firebaseUid: supervisorUid });
        if (!supervisor) {
          return res.status(404).send({ message: "Supervisor not found" });
        }

        const doc = {
          title: title.trim(),
          message: message.trim(),
          supervisorUid,
          supervisorName: supervisor.name || "",
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await announcementsCollection.insertOne(doc);
        res.send({
          message: "Announcement created",
          insertedId: result.insertedId
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


    app.get("/announcements", async (req, res) => {
      try {
        const { viewerUid, viewerRole } = req.query;

        if (!viewerUid || !viewerRole) {
          return res.status(400).send({ message: "viewerUid and viewerRole required" });
        }

        let supervisorUid = null;

        if (viewerRole === "supervisor") {
          supervisorUid = viewerUid;
        } else if (viewerRole === "student") {
          supervisorUid = await getAssignedSupervisorUid(viewerUid);
          if (!supervisorUid) {
            return res.send([]);
          }
        } else {
          return res.status(403).send({ message: "Not allowed" });
        }

        const items = await announcementsCollection
          .find({ supervisorUid })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(items);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/announcements/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { title, message, supervisorUid } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }

        const announcement = await announcementsCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!announcement) {
          return res.status(404).send({ message: "Announcement not found" });
        }

        if (announcement.supervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        const updateDoc = {
          updatedAt: new Date()
        };

        if (title !== undefined) {
          if (!title.trim()) {
            return res.status(400).send({ message: "title required" });
          }
          updateDoc.title = title.trim();
        }

        if (message !== undefined) {
          if (!message.trim()) {
            return res.status(400).send({ message: "message required" });
          }
          updateDoc.message = message.trim();
        }

        await announcementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateDoc }
        );

        res.send({ message: "Announcement updated" });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.delete("/announcements/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { supervisorUid } = req.body;

        if (!supervisorUid) {
          return res.status(400).send({ message: "supervisorUid required" });
        }

        const announcement = await announcementsCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!announcement) {
          return res.status(404).send({ message: "Announcement not found" });
        }

        if (announcement.supervisorUid !== supervisorUid) {
          return res.status(403).send({ message: "Not allowed" });
        }

        await announcementsCollection.deleteOne({ _id: new ObjectId(id) });

        res.send({ message: "Announcement deleted" });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });




    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB ping successful!");

  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('FYP Portal Server is Running');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});