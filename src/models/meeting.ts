import {prop, arrayProp, getModelForClass} from "@typegoose/typegoose";
import {ObjectId} from "mongodb";

export class Participant {
    readonly id: ObjectId;

    @prop({ required: true, index: true, unique: true })
    tgId: number;

    @prop({ required: true })
    displayName: string;
}

export class Meeting {
    readonly id: ObjectId;

    @prop({ required: true })
    topic: string;

    @arrayProp({items: Participant, default: undefined} )
    participants?: Participant[];
}

export const MeetingModel = getModelForClass(Meeting);
export const ParticipantModel = getModelForClass(Participant);