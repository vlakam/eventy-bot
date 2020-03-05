import "./helpers/env";

import Telegraf, {ContextMessageUpdate, Extra} from "telegraf";
import { connect } from "mongoose";

import { ParticipantModel, MeetingModel } from './models/meeting';

const bot = new Telegraf(process.env.BOT_TOKEN, {
    telegram: {
        // @ts-ignore
        apiRoot: process.env.TELEGRAM_API || 'https://api.telegram.org'
    }
});

bot.use(async (ctx, next) => {
    try {
        await next();
    } catch (e) {
        console.log(e);
    }
});

const generateTextForMeeting = (meeting) => {
    const text = [
        `${meeting.topic}`,
        '',
        'Записались:',
        `${meeting.participants.map((participant, idx) => `${idx +1}. <a href="tg://user?id=${participant.tgId}">${participant.displayName}</a>`).join('\n')}`
    ];

    return text.join('\n');
};

const updateMeetingMessage = (ctx, meeting, action = 'edit') => {
    const methods = {
        'edit': ctx.editMessageText,
        'create': ctx.reply
    };

    return methods[action](generateTextForMeeting(meeting), Extra.HTML().markup((m) =>
        m.inlineKeyboard([
            m.callbackButton('Я иду', `entry ${meeting.id}`),
            m.callbackButton('Галка, отмена!', `exit ${meeting.id}`)
        ])))
};

bot.hears(/^[!\/]init (.+)$/, async (ctx: ContextMessageUpdate) => {
    const topic = ctx.match[1];
    const meeting = await MeetingModel.create({ topic, participants: [] });
    await meeting.save();
    return updateMeetingMessage(ctx, meeting, 'create');
});

bot.action(/(exit|entry) (.*)/, async (ctx) => {
    const [ _, action, meetingId ] = ctx.match;
    const { from:user } = ctx.update.callback_query;
    let participant = await ParticipantModel.findOne({ tgId: user.id });
    if (!participant) {
        participant = await ParticipantModel.create({ tgId: user.id, displayName: user.first_name });
        await participant.save();
    }

    const meeting = await MeetingModel.findById({ _id: meetingId});
    await meeting.populate('participants').execPopulate();
    if (!meeting) { return }
    if (action === 'entry') {
        if (meeting.participants.some((participant) => participant.tgId === user.id)) {
            return ctx.answerCbQuery(`Вы уже записаны`);
        }
        meeting.participants.push(participant);
    } else {
        if (meeting.participants.every((participant) => participant.tgId !== user.id)) {
            return ctx.answerCbQuery(`А вас и нету!`);
        }

        meeting.participants = meeting.participants.filter((participant) => {
            return participant.tgId !== user.id;
        });
    }
    await meeting.save();
    await updateMeetingMessage(ctx, meeting);
    if (action === 'entry') {
        return ctx.answerCbQuery(`Вы записались`);
    } else {
        return ctx.answerCbQuery(`Вы отписались`);
    }

});

const init = async () => {
    await connect(process.env.DB, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    await bot.launch();
};

init();