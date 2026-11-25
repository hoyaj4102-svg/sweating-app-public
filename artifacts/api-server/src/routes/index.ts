import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import authRouter from "./auth";
import profileRouter from "./profiles";
import classesRouter from "./classes";
import activityRouter from "./activity";
import adminRouter from "./admin";
import ownerRouter from "./owner";
import matchesRouter from "./matches";
import matchMessagesRouter from "./match-messages";
import messagesRouter from "./messages";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(accountRouter);
router.use(profileRouter);
router.use(classesRouter);
router.use(activityRouter);
router.use(adminRouter);
router.use(ownerRouter);
router.use(matchMessagesRouter);
router.use(matchesRouter);
router.use(messagesRouter);

export default router;
