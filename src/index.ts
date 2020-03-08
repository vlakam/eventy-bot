import "./helpers/env";

import Telegraf, {ContextMessageUpdate, Extra, Markup} from "telegraf";
import {connect} from "mongoose";

import {ParticipantModel, MeetingModel} from './models/meeting';

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
        `${meeting.participants.map((participant, idx) => `${idx + 1}. <a href="tg://user?id=${participant.tgId}">${participant.displayName}</a>`).join('\n')}`
    ];

    return text.join('\n');
};

const updateMeetingMessage = (ctx, meeting, isOwner = true, action = 'edit') => {
    const methods = {
        'edit': ctx.editMessageText,
        'create': ctx.reply
    };

    return methods[action](generateTextForMeeting(meeting), Extra.webPreview(false).HTML().markup((m) =>
        m.inlineKeyboard(
            [
                [
                    m.callbackButton('Я иду', `entry ${meeting.id}`, isOwner),
                    m.callbackButton('Галка, отмена!', `exit ${meeting.id}`, isOwner)
                ],
                [
                    m.callbackButton('Обновить данные', `update ${meeting.id}`, !isOwner)
                ],
                [
                    m.switchToChatButton('Переслать', `${meeting.id}`, !isOwner)
                ]
            ]
        )));
};

bot.hears(/^[!\/]init (.+)$/mg, async (ctx: ContextMessageUpdate) => {
    const topic = ctx.match[1];
    // @ts-ignore
    const formattedText = Markup.formatHTML(ctx.message.text, ctx.message.entities).slice(6);
    const meeting = await MeetingModel.create({topic:formattedText, participants: []});
    await meeting.save();
    await updateMeetingMessage(ctx, meeting, true, 'create');
});

bot.action(/update (.*)/, async (ctx) => {
    const [_, meetingId] = ctx.match;
    const meeting = await MeetingModel.findById({_id: meetingId});
    await meeting.populate('participants').execPopulate();
    try {
        await updateMeetingMessage(ctx, meeting, true, 'edit');
    } catch (ignored) {}

    return ctx.answerCbQuery();
});

bot.action(/(exit|entry) (.*)/, async (ctx) => {
    const [_, action, meetingId] = ctx.match;
    const {from: user} = ctx.update.callback_query;
    let participant = await ParticipantModel.findOne({tgId: user.id});
    if (!participant) {
        participant = await ParticipantModel.create({tgId: user.id, displayName: user.first_name});
        await participant.save();
    }

    const meeting = await MeetingModel.findById({_id: meetingId});
    await meeting.populate('participants').execPopulate();
    if (!meeting) {
        return
    }
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
    await updateMeetingMessage(ctx, meeting, false);
    if (action === 'entry') {
        return ctx.answerCbQuery(`Вы записались`);
    } else {
        return ctx.answerCbQuery(`Вы отписались`);
    }

});

bot.on('inline_query', async (ctx) => {
    const { inlineQuery, answerInlineQuery } = ctx;
    if (inlineQuery.query && inlineQuery.query.length === 24) {
        const meeting = await MeetingModel.findById({_id: inlineQuery.query});
        if (meeting) {
            return answerInlineQuery(
                [{
                    type: 'article',
                    id: inlineQuery.query,
                    title: 'Переслать встречу',
                    description: meeting.topic,
                    input_message_content: {
                        message_text: meeting.topic,
                        parse_mode: 'HTML'
                    },
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '⏳ Ждите', callback_data: 'gen' }
                            ]
                        ]
                    }
                }],
                {
                    is_personal: true,
                    cache_time: 0
                }
            )
        }
    }
});


bot.on('chosen_inline_result', async (ctx) => {
    const { chosenInlineResult } = ctx;
    const { query, inline_message_id } = chosenInlineResult;
    if (query && inline_message_id) {
        const meeting = await MeetingModel.findById({_id: query});
        await meeting.populate('participants').execPopulate();
        updateMeetingMessage(ctx, meeting, false);
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